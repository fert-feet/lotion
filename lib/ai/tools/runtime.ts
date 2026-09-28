// 工具运行时公共件：事件词汇 / doom loop / 输出包装 / 日志辅助。
//
// 独立成模块的原因：**打破循环依赖** ——
//   lib/ai/tools/index.ts（内置工具目录 + registerBuiltinTools）
//   lib/ai/tools/registry.ts（注册表组装 + 守卫流水线）
// 两者都需要这些件，但注册表不能反向 import 目录（否则循环）。
import { logger } from "@/lib/logger";

/**
 * 工具名。
 * 刻意是**开放字符串**而不是封闭联合：工具由插件注册（可增可减），
 * 目录不再是编译期枚举（这是本阶段去耦合的关键之一）。
 */
export type ToolName = string;

/**
 * 工具事件（对齐 DSH agent 的 tool/start + tool/end 生命周期）：
 * - tool_start / tool_end：由注册表的包装层自动发出（含请求内自增 seq 供前端作卡片 key）
 * - note_created / note_modified / confirm_delete / confirm_move / reference：工具副作用，
 *   tool 通过注入的 onEvent 回调上报，agent 层透传为 SSE 事件
 * - question / todo_update：结构化提问与会话任务清单
 */
export type ToolEvent =
  | {
      type: "tool_start";
      tool: ToolName;
      seq: number;
      argsText: string;
      /** 原始参数（agent 用它在**写入前**给文档拍快照，实现"撤销本次改动"） */
      args?: unknown;
    }
  | { type: "tool_end"; tool: ToolName; seq: number; ok: boolean; summary: string; error?: string }
  | {
      type: "note_created";
      noteId: string;
      title: string;
      /** 创建在哪个父文档下（null = 根目录）——前端在对话卡片上显示"位置" */
      parentTitle?: string | null;
    }
  | { type: "note_modified"; noteId: string; title: string }
  | { type: "confirm_delete"; noteId: string; title: string }
  | { type: "confirm_move"; noteId: string; title: string; targetTitle: string | null; toRoot: boolean }
  | {
      type: "question";
      questions: Array<{
        header: string;
        question: string;
        options: Array<{ label: string; description: string }>;
        multiple?: boolean;
        custom?: boolean;
      }>;
    }
  | {
      type: "todo_update";
      items: Array<{ content: string; status: "pending" | "in_progress" | "completed" | "cancelled" }>;
    }
  | { type: "reference"; noteId: string; title: string };

/** 工具执行超时（毫秒）：防止 execute 卡死导致 Agent 挂起 */
export const TOOL_TIMEOUT_MS = 30_000;

/** 日志/异常参数截断，避免刷屏 */
export function truncate(value: unknown, max = 200): unknown {
  if (typeof value === "string") {
    return value.length > max ? `${value.slice(0, max)}…(+${value.length - max}字)` : value;
  }
  if (Array.isArray(value)) return value.map((item) => truncate(item, max));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = truncate(item, max);
    }
    return out;
  }
  return value;
}

/** 参数展示文本：JSON 序列化 + 截断（tool_start 的 argsText） */
export function argsText(args: unknown): string {
  try {
    const text = JSON.stringify(args, null, 2);
    return text.length > 400 ? `${text.slice(0, 400)}…` : text;
  } catch {
    return String(args);
  }
}

/** 失败特征词：doom loop 检测判据（工具返回文本含这些词视为"失败"） */
const FAILURE_HINTS = /不存在|失败|拒绝|错误|无法|不能|无效|未找到|取消/;

/** 判断一次工具结果是否"失败或无返回"（对齐 SiYuan doom loop 判据） */
export function looksLikeFailure(result: string): boolean {
  return !result || result.trim() === "" || FAILURE_HINTS.test(result);
}

/**
 * 工具输出包裹（对齐 SiYuan [tool_output]...[/tool_output]）：
 * 返回给模型的工具结果统一包裹，配合系统提示中的注入防护声明，
 * 让模型把工具输出当数据而非指令。
 */
export function wrapToolOutput(text: string): string {
  return `[tool_output]\n${text}\n[/tool_output]`;
}

/** 没有专属摘要时的降级文案：结果前 60 字 */
export function summariseFallback(result: string): string {
  const text = (result || "").trim();
  if (text === "") return "完成（无返回）";
  return text.length > 60 ? `${text.slice(0, 60)}…` : text;
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
  const sortDeep = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(sortDeep);
    if (value && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(value as Record<string, unknown>).sort()) {
        out[key] = sortDeep((value as Record<string, unknown>)[key]);
      }
      return out;
    }
    return value;
  };
  try {
    return `${name}|${JSON.stringify(sortDeep(args))}`;
  } catch {
    return `${name}|${String(args)}`;
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
        if (prevName !== null) handlers.onWarn?.(prevName, count);
      }
      if (count >= DOOM_LOOP_STOP_THRESHOLD) {
        logger.tools.error("[doomLoop] 重复失败终止", { name: prevName, count });
        if (prevName !== null) handlers.onStop?.(prevName, count);
      }
    },
  };
}
