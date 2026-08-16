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

/**
 * 工具副作用事件：tool 通过注入的 onEvent 回调上报，agent 层转成 SSE 事件推送。
 * 取代旧的"共享可变对象（pendingNoteId.current 等）+ 轮询"通信方式：
 * - 事件类型显式可枚举，新增副作用不会漏推
 * - 不再有多个 tool 写同一个对象的顺序耦合
 */
export type ToolEvent =
  | { type: "note_created"; noteId: string }
  | { type: "confirm_delete"; noteId: string; title: string }
  | { type: "note_modified"; noteId: string }
  | { type: "reference"; noteId: string; title: string };

/** 工具中文标签（agent 层 progress 事件展示用，与工具定义同处维护） */
export const TOOL_LABELS: Record<string, string> = {
  searchNotes: "🔍 搜索笔记",
  readNote: "📖 读取笔记",
  createNote: "✍️ 创建笔记",
  updateNote: "📝 更新内容",
  renameNote: "🏷️ 重命名",
  archiveNote: "📦 归档",
  deleteNote: "🗑️ 删除",
};

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
  if (typeof v === "string") return v.length > max ? `${v.slice(0, max)}…(+${v.length - max}字)` : v;
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

/**
 * 统一包装工具 execute：
 * - 记录输入参数、返回结果、耗时（此前只记录"开始"，卡死/异常完全不可见）
 * - try/catch 捕获异常并带堆栈入日志，同时给 AI 返回明确错误信息
 * - 设置显式超时，避免 execute 挂起
 */
function withToolLogging(name: string, t: AnyTool): AnyTool {
  const rawExecute = t.execute;
  if (typeof rawExecute !== "function") return t;
  const execute = rawExecute as (args: unknown, options?: unknown) => Promise<unknown>;
  return {
    ...t,
    timeout: TOOL_TIMEOUT_MS,
    execute: async (args: unknown) => {
      const start = Date.now();
      try {
        const result = await execute(args);
        logger.tools.info(`[${name}] 完成`, {
          args: truncate(args),
          result: truncate(result),
          ms: Date.now() - start,
        });
        return result;
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        logger.tools.error(`[${name}] 异常`, {
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
  const tools: Record<string, AnyTool> = {
    searchNotes: createSearchNotesTool(db, userId),
    readNote: createReadNoteTool(db, userId),
    createNote: createCreateNoteTool(db, userId, onEvent),
    updateNote: createUpdateNoteTool(db, userId, onEvent),
    renameNote: createRenameNoteTool(db, userId, onEvent),
    archiveNote: createArchiveNoteTool(db, userId),
    deleteNote: createDeleteNoteTool(db, userId, onEvent),
  };

  const wrapped: Record<string, AnyTool> = {};
  for (const [name, t] of Object.entries(tools)) {
    wrapped[name] = withToolLogging(name, t);
  }
  // 内部容器结构满足 streamText 的 ToolSet 要求（description/inputSchema/execute/timeout）
  return wrapped as unknown as ToolSet;
}
