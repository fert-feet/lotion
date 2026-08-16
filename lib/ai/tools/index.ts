import type Database from "better-sqlite3";
import type { ToolSet } from "ai";
import { logger } from "@/lib/logger";
import { createSearchNotesTool } from "./search-notes";
import { createReadNoteTool } from "./read-note";
import { createCreateNoteTool } from "./create-note";
import { createUpdateNoteTool } from "./update-note";
import { createRenameNoteTool } from "./rename-note";
import { createMoveNoteTool } from "./move-note";
import { createSetNoteIconTool } from "./set-note-icon";
import { createPublishNoteTool } from "./publish-note";
import { createArchiveNoteTool } from "./archive-note";
import { createRestoreNoteTool } from "./restore-note";
import { createListTrashTool } from "./list-trash";
import { createDeleteNoteTool } from "./delete-note";
import { createListNotesTool } from "./list-notes";
import { createAskUserTool, type AskQuestion } from "./ask-user";
import { createTodoWriteTool, type TodoItem } from "./todo-write";
import { createGetDocInfoTool } from "./doc-info";
import { createGetDocOutlineTool } from "./doc-outline";
import { createGetDocBlocksTool } from "./doc-blocks";
import { createUpdateBlockTool } from "./update-block";

/** 工具执行超时（毫秒）：防止 execute 卡死导致 Agent 挂起 */
const TOOL_TIMEOUT_MS = 30_000;

export type ToolName =
  | "searchNotes"
  | "listNotes"
  | "readNote"
  | "createNote"
  | "updateNote"
  | "renameNote"
  | "moveNote"
  | "setNoteIcon"
  | "publishNote"
  | "archiveNote"
  | "restoreNote"
  | "listTrash"
  | "deleteNote"
  | "askUser"
  | "todoWrite"
  | "getDocInfo"
  | "getDocOutline"
  | "getDocBlocks"
  | "updateBlock";

/**
 * 工具事件（对齐 DSH agent 的 tool/start + tool/end 生命周期）：
 * - tool_start / tool_end：由统一包装层自动发出（含请求内自增 seq 供前端作卡片 key）
 * - note_created / note_modified / confirm_delete / confirm_move / reference：工具副作用，
 *   tool 通过注入的 onEvent 回调上报，agent 层透传为 SSE 事件
 * - question / todo_update：对齐 SiYuan agent 的 question / todo_write 工具——
 *   结构化提问（前端选项卡片，回答作为后续消息回传）与会话任务清单
 */
export type ToolEvent =
  | { type: "tool_start"; tool: ToolName; seq: number; argsText: string }
  | { type: "tool_end"; tool: ToolName; seq: number; ok: boolean; summary: string; error?: string }
  | { type: "note_created"; noteId: string; title: string }
  | { type: "note_modified"; noteId: string; title: string }
  | { type: "confirm_delete"; noteId: string; title: string }
  | { type: "confirm_move"; noteId: string; title: string; targetTitle: string | null; toRoot: boolean }
  | { type: "question"; questions: AskQuestion[] }
  | { type: "todo_update"; items: TodoItem[] }
  | { type: "reference"; noteId: string; title: string };

/** 工具元数据：名称 / 展示标签 / 图标 / 描述（工具定义与展示同处维护） */
export const TOOL_META: Record<ToolName, { label: string; icon: string; description: string }> = {
  searchNotes: { label: "搜索笔记", icon: "🔍", description: "按标题和正文关键词搜索笔记" },
  listNotes: { label: "浏览笔记", icon: "📂", description: "浏览笔记目录（全部或指定父笔记的子文档）" },
  readNote: { label: "读取笔记", icon: "📖", description: "读取笔记完整内容" },
  createNote: { label: "创建笔记", icon: "✍️", description: "创建一篇新笔记" },
  updateNote: { label: "更新笔记", icon: "📝", description: "修改已有笔记内容" },
  renameNote: { label: "重命名", icon: "🏷️", description: "重命名笔记标题" },
  moveNote: { label: "移动笔记", icon: "📦", description: "移动笔记到其他父笔记下（需确认）" },
  setNoteIcon: { label: "设置图标", icon: "🎨", description: "设置或清除笔记的 emoji 图标" },
  publishNote: { label: "发布笔记", icon: "🌐", description: "发布或取消发布笔记（公开预览）" },
  archiveNote: { label: "归档笔记", icon: "🗄️", description: "归档到回收站（可恢复）" },
  restoreNote: { label: "恢复笔记", icon: "♻️", description: "从回收站恢复笔记" },
  listTrash: { label: "查看回收站", icon: "🗑️", description: "列出回收站中的笔记" },
  deleteNote: { label: "删除笔记", icon: "💥", description: "永久删除（需用户确认）" },
  askUser: { label: "询问用户", icon: "❓", description: "向用户提出结构化问题" },
  todoWrite: { label: "任务清单", icon: "✅", description: "维护会话多步任务清单" },
  getDocInfo: { label: "笔记信息", icon: "ℹ️", description: "读取笔记元数据信息" },
  getDocOutline: { label: "笔记大纲", icon: "📑", description: "读取笔记标题层级大纲" },
  getDocBlocks: { label: "块清单", icon: "🧩", description: "列出笔记块清单（定位用）" },
  updateBlock: { label: "更新块", icon: "🎯", description: "精确更新单个块（锚点/序号）" },
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
    case "listNotes":
    case "listTrash": {
      const n = pick(/找到 (\d+) 篇笔记/) ?? pick(/回收站中有 (\d+) 篇笔记/);
      return n !== null ? "找到 " + n + " 篇笔记" : "完成浏览";
    }
    case "moveNote": {
      const t = pick(/「([^」]+)」已移动/);
      return t ? "已移动「" + t + "」" : "等待用户确认移动";
    }
    case "setNoteIcon": return "图标已更新";
    case "publishNote": {
      const p = pick(/已取消发布/);
      return p !== null ? "已取消发布" : "已发布";
    }
    case "restoreNote": {
      const t = pick(/「([^」]+)」已从回收站恢复/);
      return t ? "已恢复「" + t + "」" : "已恢复";
    }
    case "archiveNote": return "已归档到回收站";
    case "deleteNote": return "等待用户确认删除";
    case "askUser": {
      const n = pick(/已向用户提出结构化问题/);
      return n !== null ? "已向用户提问" : "已提问";
    }
    case "todoWrite": {
      const n = pick(/任务清单已更新（共 (\d+) 项/);
      return n !== null ? "任务清单已更新（" + n + " 项）" : "任务清单已更新";
    }
    case "getDocInfo": {
      const t = pick(/「([^」]+)」信息/);
      return t ? "已读取「" + t + "」信息" : "已读取笔记信息";
    }
    case "getDocOutline": {
      const t = pick(/「([^」]+)」大纲/);
      return t ? "已读取「" + t + "」大纲" : "已读取大纲";
    }
    case "getDocBlocks": {
      const n = pick(/共 (\d+) 块/);
      return n !== null ? "已列出 " + n + " 个块" : "已读取块清单";
    }
    case "updateBlock": {
      const m = result.match(/已更新笔记「([^」]+)」第 (\d+) 块/);
      return m ? "已更新「" + m[1] + "」第 " + m[2] + " 块" : "已更新块";
    }
  }
}

/** 失败特征词：doom loop 检测判据（工具返回文本含这些词视为"失败"） */
const FAILURE_HINTS = /不存在|失败|拒绝|错误|无法|不能|无效|未找到|取消/;

/** 判断一次工具结果是否"失败或无返回"（对齐 SiYuan doom loop 判据） */
function looksLikeFailure(result: string): boolean {
  return !result || result.trim() === "" || FAILURE_HINTS.test(result);
}

/**
 * 工具输出包裹（对齐 SiYuan [tool_output]...[/tool_output]）：
 * 返回给模型的工具结果统一包裹，配合系统提示中的注入防护声明，
 * 让模型把工具输出当数据而非指令。
 */
function wrapToolOutput(text: string): string {
  return `[tool_output]\n${text}\n[/tool_output]`;
}

/**
 * 统一包装工具 execute（对齐 DSH 的 tool 生命周期呈现）：
 * - execute 前发 tool_start（参数摘要），成功后发 tool_end（结果摘要），异常发 tool_end(ok=false)
 * - 记录输入参数、返回结果、耗时（此前只记录"开始"，卡死/异常完全不可见）
 * - 设置显式超时，避免 execute 挂起
 * - 返回给模型的文本统一 [tool_output] 包裹（对齐 SiYuan：工具输出是不可信数据）
 * - 失败/空结果计入 doom loop 检测（对齐 SiYuan：相同签名连续失败 → 警告/终止）
 * seq 由 createTools 闭包自增（请求内唯一），供前端工具卡片做稳定 key
 */
function withToolEvents(
  name: ToolName,
  t: AnyTool,
  nextSeq: () => number,
  onEvent: (e: ToolEvent) => void,
  doom: DoomLoopTracker,
): AnyTool {
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
        const text = typeof result === "string" ? result : String(result);
        const summary = summarizeResult(name, text);
        onEvent({ type: "tool_end", tool: name, seq, ok: true, summary });
        logger.tools.info("[" + name + "] 完成", {
          args: truncate(args),
          result: truncate(text),
          ms: Date.now() - start,
        });
        // 失败/空结果计入 doom loop（成功副作用调用不参与，重置基准）
        doom.track(name, args, looksLikeFailure(text) ? "failure" : "ok");
        return wrapToolOutput(text);
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        onEvent({ type: "tool_end", tool: name, seq, ok: false, summary: err.message, error: err.message });
        logger.tools.error("[" + name + "] 异常", {
          args: truncate(args),
          error: err.message,
          stack: err.stack,
          ms: Date.now() - start,
        });
        const text = `工具 ${name} 执行出错：${err.message}。请告知用户稍后重试，或改用其他方式完成。`;
        doom.track(name, args, "failure");
        return wrapToolOutput(text);
      }
    },
  };
}

/**
 * doom loop 检测（对齐 SiYuan doomLoopTracker）：
 * 相同工具 + 相同参数签名连续失败/空结果 —— 3 次触发警告事件，5 次触发终止回调。
 * 成功的工具调用视为产生了有用副作用，重置基准。
 */
export interface DoomLoopTracker {
  track(name: ToolName, args: unknown, outcome: "ok" | "failure"): void;
}

export interface DoomLoopHandlers {
  /** 连续失败达到 warn 阈值（每次命中调用，可重复触发） */
  onWarn?: (name: ToolName, count: number) => void;
  /** 连续失败达到 stop 阈值：调用方应中止生成 */
  onStop?: (name: ToolName, count: number) => void;
}

export const DOOM_LOOP_WARN_THRESHOLD = 3;
export const DOOM_LOOP_STOP_THRESHOLD = 5;

/** 参数签名：JSON 序列化 + 键排序（键序不同的等价参数视为同签名） */
function doomSignature(name: ToolName, args: unknown): string {
  const sortDeep = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sortDeep);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(v as Record<string, unknown>).sort()) {
        out[k] = sortDeep((v as Record<string, unknown>)[k]);
      }
      return out;
    }
    return v;
  };
  try {
    return name + "|" + JSON.stringify(sortDeep(args));
  } catch {
    return name + "|" + String(args);
  }
}

export function createDoomLoopTracker(handlers: DoomLoopHandlers): DoomLoopTracker {
  let prevSig = "";
  let prevName: ToolName | null = null;
  let count = 0;
  return {
    track(name, args, outcome) {
      if (outcome === "ok") {
        // 成功调用：重置基准，避免误把后续合理调用连成"重复"
        prevSig = "";
        prevName = null;
        count = 0;
        return;
      }
      const sig = doomSignature(name, args);
      if (sig === prevSig && prevSig !== "") {
        count++;
      } else {
        prevSig = sig;
        prevName = name;
        count = 1;
      }
      if (count === DOOM_LOOP_WARN_THRESHOLD) {
        logger.tools.warn("[doomLoop] 重复失败警告", { name: prevName, count });
        handlers.onWarn?.(prevName!, count);
      }
      if (count >= DOOM_LOOP_STOP_THRESHOLD) {
        logger.tools.error("[doomLoop] 重复失败终止", { name: prevName, count });
        handlers.onStop?.(prevName!, count);
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
  doom: DoomLoopTracker = createDoomLoopTracker({}),
): ToolSet {
  const tools: Record<ToolName, AnyTool> = {
    searchNotes: createSearchNotesTool(db, userId),
    listNotes: createListNotesTool(db, userId),
    readNote: createReadNoteTool(db, userId, onEvent),
    createNote: createCreateNoteTool(db, userId, onEvent),
    updateNote: createUpdateNoteTool(db, userId, onEvent),
    renameNote: createRenameNoteTool(db, userId, onEvent),
    moveNote: createMoveNoteTool(db, userId, onEvent),
    setNoteIcon: createSetNoteIconTool(db, userId, onEvent),
    publishNote: createPublishNoteTool(db, userId, onEvent),
    archiveNote: createArchiveNoteTool(db, userId),
    restoreNote: createRestoreNoteTool(db, userId, onEvent),
    listTrash: createListTrashTool(db, userId),
    deleteNote: createDeleteNoteTool(db, userId, onEvent),
    askUser: createAskUserTool(db, userId, onEvent),
    todoWrite: createTodoWriteTool(db, userId, onEvent),
    getDocInfo: createGetDocInfoTool(db, userId),
    getDocOutline: createGetDocOutlineTool(db, userId),
    getDocBlocks: createGetDocBlocksTool(db, userId),
    updateBlock: createUpdateBlockTool(db, userId, onEvent),
  };

  // 请求内工具调用自增序号（tool 卡片稳定 key）
  let seq = 0;
  const nextSeq = () => ++seq;

  const wrapped: Record<string, AnyTool> = {};
  for (const [name, t] of Object.entries(tools)) {
    wrapped[name] = withToolEvents(name as ToolName, t, nextSeq, onEvent, doom);
  }
  // 内部容器结构满足 streamText 的 ToolSet 要求（description/inputSchema/execute/timeout）
  return wrapped as unknown as ToolSet;
}
