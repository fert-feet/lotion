"use client";

// AI 面板 turn 时间线状态模型（对齐 DSH 会话节点设计）：
// 一轮用户输入 = 一个 Turn（用户气泡 + 有序 part 序列 + 回合 footer）。
// `parts` 按 SSE 到达顺序记录叙述/工具/文档副作用/待办/提问/警告，
// 因此渲染与真实时间线一致（旧实现把所有工具卡无条件堆在文本上方）。

/** SSE 事件（与 lib/agent.ts 的 AgentStreamEvent 一一对应） */
export type SseEvent =
  | { type: "turn_start"; turn: number; startedAt: string }
  | { type: "text"; text: string }
  | { type: "tool_start"; tool: string; seq: number; label: string; argsText: string }
  | { type: "tool_end"; tool: string; seq: number; ok: boolean; summary: string; error?: string }
  | { type: "note_created"; noteId: string; title: string }
  | { type: "note_modified"; noteId: string; title: string }
  | { type: "confirm_delete"; noteId: string; title: string }
  | {
      type: "confirm_move";
      noteId: string;
      title: string;
      targetTitle: string | null;
      toRoot: boolean;
    }
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
  | { type: "reference"; noteId: string; title: string }
  | { type: "warning"; message: string }
  | { type: "turn_end"; turn: number; durationMs: number; tokens: { input: number; output: number } | null }
  | { type: "error"; message: string };

export interface ToolCardState {
  /** 请求内自增序号（稳定 key） */
  seq: number;
  tool: string;
  label: string;
  argsText: string;
  state: "running" | "done" | "error";
  summary: string;
  /** 失败时的原始错误（tool_end.error），展开区展示 */
  error?: string;
}

export type NoteEvent =
  | { kind: "created"; noteId: string; title: string }
  | { kind: "modified"; noteId: string; title: string }
  | { kind: "delete_confirm"; noteId: string; title: string; resolved: boolean }
  | {
      kind: "move_confirm";
      noteId: string;
      title: string;
      targetTitle: string | null;
      toRoot: boolean;
      resolved: boolean;
    };

export interface Reference { noteId: string; title: string }

export interface Question {
  header: string;
  question: string;
  options: Array<{ label: string; description: string }>;
  multiple?: boolean;
  custom?: boolean;
  /** 用户已作答的内容（回答作为新消息回传后回填，卡片转为不可再答） */
  answered?: string;
}

export interface TodoItem {
  content: string;
  status: "pending" | "in_progress" | "completed" | "cancelled";
}

/** 时间线 part：渲染顺序 = 事件到达顺序 */
export type TurnPart =
  | { kind: "text"; text: string }
  | { kind: "tool"; seq: number }
  | { kind: "note"; index: number }
  | { kind: "todo" }
  | { kind: "question"; index: number }
  | { kind: "warning"; index: number };

export interface Turn {
  /** 会话内自增（新轮次） */
  id: string;
  userContent: string;
  /** 叙述文本（流式累加；= 所有 text part 拼接，供重试/复制用） */
  text: string;
  /** 有序时间线（叙述 / 工具 / 副作用 / 待办 / 提问 / 警告） */
  parts: TurnPart[];
  tools: ToolCardState[];
  notes: NoteEvent[];
  references: Reference[];
  /** 结构化提问（对齐 SiYuan question 工具：选项卡片，回答回传为新消息） */
  questions: Question[];
  /** 会话任务清单（对齐 SiYuan todo_write 工具：整体替换） */
  todos: TodoItem[];
  /** doom loop 等警告（同时 toast；刷新后由快照恢复） */
  warnings: string[];
  status: "running" | "done" | "error";
  /** status === "error" 时的原因 */
  errorMessage?: string;
  /** 本轮随消息附上的文本附件（只存名称与字符数；正文当轮用完即弃） */
  attachments: Array<{ name: string; size: number }>;
  /** 本轮被 AI 写过的文档（非空 = 可撤销）；刷新后由快照恢复 */
  changedDocuments: string[];
  /** 该轮对应的服务端请求 id（撤销接口的入参）；旧数据/未落库时为 null */
  requestId: string | null;
  /** 用户已撤销本轮改动（内存态，避免重复点） */
  undone?: boolean;
  durationMs: number | null;
  tokens: { input: number; output: number } | null;
  createdAt: number;
}

export function createTurn(userContent: string): Turn {
  return {
    id: crypto.randomUUID(),
    userContent,
    text: "",
    parts: [],
    tools: [],
    notes: [],
    references: [],
    questions: [],
    todos: [],
    warnings: [],
    status: "running",
    attachments: [],
    changedDocuments: [],
    requestId: null,
    durationMs: null,
    tokens: null,
    createdAt: Date.now(),
  };
}

/** 相对时间（紧凑格式） */
export function formatDuration(ms: number): string {
  if (ms < 1000) return ms + "ms";
  const s = Math.round(ms / 1000);
  if (s < 60) return s + "s";
  const m = Math.floor(s / 60);
  return m + "m " + (s % 60) + "s";
}

/** 时钟：15s 后显示耗时（对齐 DSH TurnStatus） */
export function formatClock(ms: number): string {
  return formatDuration(ms);
}
