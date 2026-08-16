import type Database from "better-sqlite3";
import type { ToolSet } from "ai";
import { logger } from "@/lib/logger";
import { createSearchNotesTool } from "./search-notes";
import { createReadNoteTool } from "./read-note";
import { createCreateNoteTool } from "./create-note";
import { createUpdateNoteTool } from "./update-note";
import { createRenameNoteTool } from "./rename-note";
import { createArchiveNoteTool } from "./archive-note";
import { createDeleteNoteTool } from "./delete-note";

/** 工具执行超时（毫秒）：防止 execute 卡死导致 Agent 挂起 */
const TOOL_TIMEOUT_MS = 30_000;

export type ToolName =
  | "searchNotes"
  | "readNote"
  | "createNote"
  | "updateNote"
  | "renameNote"
  | "archiveNote"
  | "deleteNote";

/**
 * 工具事件（对齐 DSH agent 的 tool/start + tool/end 生命周期）：
 * - tool_start / tool_end：由统一包装层自动发出（含请求内自增 seq 供前端作卡片 key）
 * - note_created / note_modified / confirm_delete / reference：工具副作用，
 *   tool 通过注入的 onEvent 回调上报，agent 层透传为 SSE 事件
 */
export type ToolEvent =
  | { type: "tool_start"; tool: ToolName; seq: number; argsText: string }
  | { type: "tool_end"; tool: ToolName; seq: number; ok: boolean; summary: string; error?: string }
  | { type: "note_created"; noteId: string; title: string }
  | { type: "note_modified"; noteId: string; title: string }
  | { type: "confirm_delete"; noteId: string; title: string }
  | { type: "reference"; noteId: string; title: string };

/** 工具元数据：名称 / 展示标签 / 图标 / 描述（工具定义与展示同处维护） */
export const TOOL_META: Record<ToolName, { label: string; icon: string; description: string }> = {
  searchNotes: { label: "搜索笔记", icon: "🔍", description: "按标题关键词搜索笔记" },
  readNote: { label: "读取笔记", icon: "📖", description: "读取笔记完整内容" },
  createNote: { label: "创建笔记", icon: "✍️", description: "创建一篇新笔记" },
  updateNote: { label: "更新笔记", icon: "📝", description: "修改已有笔记内容" },
  renameNote: { label: "重命名", icon: "🏷️", description: "重命名笔记标题" },
  archiveNote: { label: "归档笔记", icon: "📦", description: "归档到回收站（可恢复）" },
  deleteNote: { label: "删除笔记", icon: "🗑️", description: "永久删除（需用户确认）" },
};

/** 兼容旧引用：工具中文标签映射 */
export const TOOL_LABELS: Record<string, string> = Object.fromEntries(
  Object.entries(TOOL_META).map(([k, v]) => [k, `${v.icon} ${v.label}`]),
);

type AnyTool = {
  type?: unknown;
  description?: unknown;
  inputSchema?: unknown;
  parameters?: unknown;
  execute?: unknown;
  [key: string]: unknown;
};

/** 日志/异常参数截断，避免刷屏 */
function truncate(v: unknown, max = 200): unknown {
  if (typeof v === "string") return v.length > max ? v.slice(0, max) + "…(+" + (v.length - max) + "字)" : v;
  if (Array.isArray(v)) return v.map((x) => truncate(x, max));
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[k] = truncate(val, max);
    }
    return out;
  }
  return v;
}

/** 参数展示文本：JSON 序列化 + 截断（tool_start 的 argsText） */
function argsText(args: unknown): string {
  try {
    const s = JSON.stringify(args, null, 2);
    return s.length > 400 ? s.slice(0, 400) + "…" : s;
  } catch {
    return String(args);
  }
}

/**
 * 每个工具的结果摘要（tool_end 卡片 summary）：
 * 从返回给模型的文本里提取一句人话，带工具自身的语义，
 * 失败/缺失时降级为错误信息或结果前 60 字。
 */
function summarizeResult(tool: ToolName, result: string): string {
  const pick = (re: RegExp): string | null => {
    const m = result.match(re);
    return m ? m[1] : null;
  };
  switch (tool) {
    case "searchNotes": {
      const n = pick(/找到 (\d+) 篇笔记/);
      return n !== null ? "找到 " + n + " 篇笔记" : "完成搜索";
    }
    case "readNote": {
      const t = pick(/笔记「([^」]+)」/);
      return t ? "已读取「" + t + "」" : "完成读取";
    }
    case "createNote": {
      const t = pick(/笔记「([^」]+)」已创建/);
      return t ? "已创建「" + t + "」（草稿）" : "已创建草稿";
    }
    case "updateNote": return "内容已更新";
    case "renameNote": {
      const t = pick(/「([^」]+)」/);
      return t ? "已重命名为「" + t + "」" : "已重命名";
    }
    case "archiveNote": return "已归档到回收站";
    case "deleteNote": return "等待用户确认删除";
  }
}

/**
 * 统一包装工具 execute（对齐 DSH 的 tool 生命周期呈现）：
 * - execute 前发 tool_start（参数摘要），成功后发 tool_end（结果摘要），异常发 tool_end(ok=false)
 * - 记录输入参数、返回结果、耗时（此前只记录"开始"，卡死/异常完全不可见）
 * - 设置显式超时，避免 execute 挂起
 * seq 由 createTools 闭包自增（请求内唯一），供前端工具卡片做稳定 key
 */
function withToolEvents(name: ToolName, t: AnyTool, nextSeq: () => number, onEvent: (e: ToolEvent) => void): AnyTool {
  const rawExecute = t.execute;
  if (typeof rawExecute !== "function") return t;
  const execute = rawExecute as (args: unknown, options?: unknown) => Promise<unknown>;
  return {
    ...t,
    timeout: TOOL_TIMEOUT_MS,
    execute: async (args: unknown) => {
      const seq = nextSeq();
      const start = Date.now();
      onEvent({ type: "tool_start", tool: name, seq, argsText: argsText(args) });
      try {
        const result = await execute(args);
        const summary = typeof result === "string" ? summarizeResult(name, result) : summarizeResult(name, String(result));
        onEvent({ type: "tool_end", tool: name, seq, ok: true, summary });
        logger.tools.info("[" + name + "] 完成", {
          args: truncate(args),
          result: truncate(result),
          ms: Date.now() - start,
        });
        return result;
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        onEvent({ type: "tool_end", tool: name, seq, ok: false, summary: err.message, error: err.message });
        logger.tools.error("[" + name + "] 异常", {
          args: truncate(args),
          error: err.message,
          stack: err.stack,
          ms: Date.now() - start,
        });
        return `工具 ${name} 执行出错：${err.message}。请告知用户稍后重试，或改用其他方式完成。`;
      }
    },
  };
}

/**
 * 创建 Agent 工具集（本地版：直接接收 SQLite 连接实例）。
 * 副作用通过 onEvent 回调上报（见 ToolEvent），
 * 不再接收共享可变状态对象——tool 实例按请求创建，闭包状态天然按请求隔离。
 */
export function createTools(
  db: Database.Database,
  userId: string,
  onEvent: (event: ToolEvent) => void = () => {},
): ToolSet {
  const tools: Record<ToolName, AnyTool> = {
    searchNotes: createSearchNotesTool(db, userId),
    readNote: createReadNoteTool(db, userId, onEvent),
    createNote: createCreateNoteTool(db, userId, onEvent),
    updateNote: createUpdateNoteTool(db, userId, onEvent),
    renameNote: createRenameNoteTool(db, userId, onEvent),
    archiveNote: createArchiveNoteTool(db, userId),
    deleteNote: createDeleteNoteTool(db, userId, onEvent),
  };

  // 请求内工具调用自增序号（tool 卡片稳定 key）
  let seq = 0;
  const nextSeq = () => ++seq;

  const wrapped: Record<string, AnyTool> = {};
  for (const [name, t] of Object.entries(tools)) {
    wrapped[name] = withToolEvents(name as ToolName, t, nextSeq, onEvent);
  }
  // 内部容器结构满足 streamText 的 ToolSet 要求（description/inputSchema/execute/timeout）
  return wrapped as unknown as ToolSet;
}
