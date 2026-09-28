// AI 回合快照：assistant 消息的**结构化副产物**（工具卡 / 文档副作用 / 引用 /
// 待办 / 提问 / 警告 / 耗时），随消息一起落库（chat_messages.metadata JSON）。
//
// 为什么需要它：消息表只有 role+content，刷新或切换会话后只剩一段纯文本 ——
// 工具卡、确认卡、引用、提问卡片全部消失（"已创建草稿/待确认删除"这类待办状态
// 直接丢失）。此外 durationMs 只能靠快照恢复，否则 footer 会显示"耗时 0ms"。
//
// 为什么放在 lib/ 根（而不是 lib/ai/）：服务端（agent 生成快照）与客户端
// （AI 面板重建时间线）都要用它，而 test/boundary.test.ts 禁止客户端值导入
// `@/lib/ai/*`。本模块必须保持环境无关：不得 import node:/better-sqlite3/React。

/** 快照 version：将来结构变化时前端可按版本降级 */
export const TURN_SNAPSHOT_VERSION = 1;

export interface SnapshotToolCard {
  seq: number;
  tool: string;
  label: string;
  argsText: string;
  state: "running" | "done" | "error";
  summary: string;
  error?: string;
}

export type SnapshotNote =
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

export interface SnapshotReference {
  noteId: string;
  title: string;
}

export interface SnapshotQuestion {
  header: string;
  question: string;
  options: Array<{ label: string; description: string }>;
  multiple?: boolean;
  custom?: boolean;
  answered?: string;
}

export interface SnapshotTodo {
  content: string;
  status: "pending" | "in_progress" | "completed" | "cancelled";
}

/**
 * 时间线分段：与前端 TurnPart 同构，但文本段只记**字符数**（正文已经在
 * chat_messages.content 里，避免同一段文字存两份）。重建时按序从 content 切片；
 * 切片总长与 content 不一致时，剩余部分补成一个文本段（自愈，不丢字）。
 */
export type SnapshotPart =
  | { kind: "text"; chars: number }
  | { kind: "tool"; seq: number }
  | { kind: "note"; index: number }
  | { kind: "todo" }
  | { kind: "question"; index: number }
  | { kind: "warning"; index: number };

export interface TurnSnapshot {
  version: number;
  durationMs: number | null;
  /** 该轮以失败告终时的原因（error 事件 / doom loop 终止）；正常结束为 null */
  errorMessage: string | null;
  parts: SnapshotPart[];
  tools: SnapshotToolCard[];
  notes: SnapshotNote[];
  references: SnapshotReference[];
  questions: SnapshotQuestion[];
  todos: SnapshotTodo[];
  warnings: string[];
}

/** 空快照（新建轮次时用；服务端 agent 每轮从它开始累积） */
export function createTurnSnapshot(): TurnSnapshot {
  return {
    version: TURN_SNAPSHOT_VERSION,
    durationMs: null,
    errorMessage: null,
    parts: [],
    tools: [],
    notes: [],
    references: [],
    questions: [],
    todos: [],
    warnings: [],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asStringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * 宽容解析持久化的快照（数据可能来自旧版本/被手工改坏）：
 * 结构不认识就返回 null，前端退化成"纯文本时间线"，绝不因此崩面板。
 */
export function parseTurnSnapshot(value: unknown): TurnSnapshot | null {
  let raw: unknown = value;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!isRecord(raw)) return null;
  if (!Array.isArray(raw.parts)) return null;

  const snapshot = createTurnSnapshot();
  snapshot.durationMs = typeof raw.durationMs === "number" ? raw.durationMs : null;
  snapshot.errorMessage = typeof raw.errorMessage === "string" ? raw.errorMessage : null;

  for (const part of raw.parts) {
    if (!isRecord(part)) continue;
    switch (part.kind) {
      case "text":
        snapshot.parts.push({ kind: "text", chars: asNumber(part.chars) });
        break;
      case "tool":
        snapshot.parts.push({ kind: "tool", seq: asNumber(part.seq) });
        break;
      case "note":
        snapshot.parts.push({ kind: "note", index: asNumber(part.index) });
        break;
      case "todo":
        snapshot.parts.push({ kind: "todo" });
        break;
      case "question":
        snapshot.parts.push({ kind: "question", index: asNumber(part.index) });
        break;
      case "warning":
        snapshot.parts.push({ kind: "warning", index: asNumber(part.index) });
        break;
    }
  }

  for (const tool of asArray(raw.tools)) {
    if (!isRecord(tool)) continue;
    snapshot.tools.push({
      seq: asNumber(tool.seq),
      tool: asString(tool.tool),
      label: asString(tool.label),
      argsText: asString(tool.argsText),
      state: tool.state === "error" ? "error" : tool.state === "running" ? "running" : "done",
      summary: asString(tool.summary),
      error: typeof tool.error === "string" ? tool.error : undefined,
    });
  }

  for (const note of asArray(raw.notes)) {
    if (!isRecord(note)) continue;
    const noteId = asString(note.noteId);
    const title = asString(note.title);
    if (note.kind === "created" || note.kind === "modified") {
      snapshot.notes.push({ kind: note.kind, noteId, title });
    } else if (note.kind === "delete_confirm") {
      snapshot.notes.push({ kind: "delete_confirm", noteId, title, resolved: note.resolved === true });
    } else if (note.kind === "move_confirm") {
      snapshot.notes.push({
        kind: "move_confirm",
        noteId,
        title,
        targetTitle: asStringOrNull(note.targetTitle),
        toRoot: note.toRoot === true,
        resolved: note.resolved === true,
      });
    }
  }

  for (const ref of asArray(raw.references)) {
    if (!isRecord(ref)) continue;
    const noteId = asString(ref.noteId);
    if (noteId) snapshot.references.push({ noteId, title: asString(ref.title) });
  }

  for (const q of asArray(raw.questions)) {
    if (!isRecord(q)) continue;
    snapshot.questions.push({
      header: asString(q.header),
      question: asString(q.question),
      options: asArray(q.options)
        .filter(isRecord)
        .map((opt) => ({ label: asString(opt.label), description: asString(opt.description) })),
      multiple: q.multiple === true,
      custom: q.custom !== false,
      answered: typeof q.answered === "string" ? q.answered : undefined,
    });
  }

  for (const todo of asArray(raw.todos)) {
    if (!isRecord(todo)) continue;
    const status = todo.status;
    snapshot.todos.push({
      content: asString(todo.content),
      status:
        status === "in_progress" || status === "completed" || status === "cancelled"
          ? status
          : "pending",
    });
  }

  for (const warning of asArray(raw.warnings)) {
    if (typeof warning === "string") snapshot.warnings.push(warning);
  }

  return snapshot;
}
