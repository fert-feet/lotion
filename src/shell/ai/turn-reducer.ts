"use client";

// AI 面板的 turn 时间线**纯逻辑层**（从 ai-panel.tsx 的闭包里抽出来）：
// SSE 事件 → turn 状态、扁平消息历史 → turn 时间线、确认卡/提问卡的状态流转、发送队列。
//
// 抽出来的两个理由：
// 1. 可测：这些规则（乱序 tool_end、error 后 turn_end 不翻案、确认卡去重、
//    队列按会话取件）以前藏在 695 行的组件闭包里，只能靠手点验证；
// 2. 可复用：恢复会话（快照）与实时流走同一套规则，不会两处漂移。
//
// 约定：`applyTurnEvent` **就地**修改传入的 turn（面板持有 currentTurnRef，
// 改完由调用方 commit 触发渲染）；其余函数返回新数组/新对象，便于测试与 React 比较。

import type { ChatMessage } from "@/lib/seams/doc-store";
import { parseTurnSnapshot, type TurnSnapshot } from "@/lib/chat-snapshot";
import { createTurn, type NoteEvent, type SseEvent, type Turn, type TurnPart } from "./types";

/** 事件带来的外部副作用：由组件层执行（toast / 路由 / 刷新），reducer 不碰 IO */
export type TurnEffect =
  | { kind: "toast"; level: "warning" | "error"; message: string }
  | { kind: "note_created"; noteId: string; title: string }
  | { kind: "note_modified"; noteId: string; title: string };

/** 追加文本：连续 chunk 合并进同一个 text part，保持 part 数量与语义段一致 */
function appendText(turn: Turn, chunk: string): void {
  const last = turn.parts[turn.parts.length - 1];
  if (last && last.kind === "text") {
    last.text += chunk;
  } else {
    turn.parts.push({ kind: "text", text: chunk });
  }
  turn.text += chunk;
}

/**
 * 消费一条 SSE 事件，就地更新 turn，返回需要外部执行的效果。
 * 未知事件类型直接忽略（服务端新增事件时前端不崩）。
 */
export function applyTurnEvent(turn: Turn, event: SseEvent): TurnEffect[] {
  const effects: TurnEffect[] = [];
  switch (event.type) {
    case "turn_start":
      break; // turn 在发送时已创建
    case "text":
      appendText(turn, event.text);
      break;
    case "tool_start":
      turn.tools.push({
        seq: event.seq,
        tool: event.tool,
        label: event.label,
        argsText: event.argsText,
        state: "running",
        summary: "",
      });
      turn.parts.push({ kind: "tool", seq: event.seq });
      break;
    case "tool_end": {
      const card = turn.tools.find((c) => c.seq === event.seq);
      if (card) {
        card.state = event.ok ? "done" : "error";
        card.summary = event.summary;
        card.error = event.ok ? undefined : event.error;
      }
      break;
    }
    case "note_created":
      turn.notes.push({ kind: "created", noteId: event.noteId, title: event.title });
      turn.parts.push({ kind: "note", index: turn.notes.length - 1 });
      effects.push({ kind: "note_created", noteId: event.noteId, title: event.title });
      break;
    case "note_modified":
      turn.notes.push({ kind: "modified", noteId: event.noteId, title: event.title });
      turn.parts.push({ kind: "note", index: turn.notes.length - 1 });
      if (!turn.changedDocuments.includes(event.noteId)) turn.changedDocuments.push(event.noteId);
      effects.push({ kind: "note_modified", noteId: event.noteId, title: event.title });
      break;
    case "confirm_delete":
      // 同一个待确认文档只放一张卡（AI 可能重复调用）
      if (!hasPendingConfirm(turn.notes, "delete_confirm", event.noteId)) {
        turn.notes.push({
          kind: "delete_confirm",
          noteId: event.noteId,
          title: event.title,
          resolved: false,
        });
        turn.parts.push({ kind: "note", index: turn.notes.length - 1 });
      }
      break;
    case "confirm_move":
      if (!hasPendingConfirm(turn.notes, "move_confirm", event.noteId)) {
        turn.notes.push({
          kind: "move_confirm",
          noteId: event.noteId,
          title: event.title,
          targetTitle: event.targetTitle,
          toRoot: event.toRoot,
          resolved: false,
        });
        turn.parts.push({ kind: "note", index: turn.notes.length - 1 });
      }
      break;
    case "question":
      for (const q of event.questions) {
        turn.questions.push({ ...q });
        turn.parts.push({ kind: "question", index: turn.questions.length - 1 });
      }
      break;
    case "todo_update":
      turn.todos = event.items.map((i) => ({ ...i }));
      // 待办是"整体替换"的会话状态：同一轮里只留一个 part
      if (!turn.parts.some((p) => p.kind === "todo")) turn.parts.push({ kind: "todo" });
      break;
    case "warning":
      turn.warnings.push(event.message);
      turn.parts.push({ kind: "warning", index: turn.warnings.length - 1 });
      effects.push({ kind: "toast", level: "warning", message: event.message });
      break;
    case "reference":
      if (!turn.references.some((r) => r.noteId === event.noteId)) {
        turn.references.push({ noteId: event.noteId, title: event.title });
      }
      break;
    case "turn_end":
      // error 之后到来的 turn_end 不翻案（doom loop 终止路径就是 error → turn_end）
      if (turn.status !== "error") turn.status = "done";
      turn.durationMs = event.durationMs;
      turn.tokens = event.tokens;
      break;
    case "error":
      turn.status = "error";
      turn.errorMessage = event.message;
      effects.push({ kind: "toast", level: "error", message: event.message });
      break;
  }
  return effects;
}

/** 用户消息 metadata 里的附件清单（只恢复名称/大小，正文不落库） */
export function parseUserAttachments(metadata: string | null | undefined): Array<{ name: string; size: number }> {
  if (!metadata) return [];
  try {
    const parsed = JSON.parse(metadata) as { attachments?: unknown };
    if (!Array.isArray(parsed.attachments)) return [];
    return parsed.attachments
      .filter((item): item is { name: string; size?: number } => typeof item === "object" && item !== null)
      .map((item) => ({
        name: typeof item.name === "string" ? item.name : "附件",
        size: typeof item.size === "number" ? item.size : 0,
      }));
  } catch {
    return [];
  }
}

/** 同文档同类型的未解决确认卡是否已存在 */
function hasPendingConfirm(
  notes: NoteEvent[],
  kind: "delete_confirm" | "move_confirm",
  noteId: string,
): boolean {
  return notes.some((n) => n.kind === kind && n.noteId === noteId && !n.resolved);
}

/**
 * 流自然结束（或失败/终止）时的收尾：running 的回合要么补 done，要么按调用方给定的
 * 状态落定。durationMs 为 null 时不瞎编耗时（历史恢复出来的回合没有真实耗时）。
 */
export function finalizeTurn(
  turn: Turn,
  status: "done" | "error" = "done",
  errorMessage?: string,
): void {
  if (turn.status !== "running") return;
  turn.status = status;
  if (errorMessage) turn.errorMessage = errorMessage;
  turn.durationMs = Date.now() - turn.createdAt;
}

/**
 * 扁平消息历史 → turn 时间线。
 * assistant 消息带结构化快照（chat_messages.metadata）时**完整恢复**工具卡/副作用卡/
 * 引用/待办/提问/警告/耗时；没有快照（旧数据）时退化为纯文本时间线。
 */
export function rebuildTurns(messages: ChatMessage[]): Turn[] {
  const turns: Turn[] = [];
  let current: Turn | null = null;
  for (const m of messages) {
    if (m.role === "user") {
      current = createTurn(m.content);
      // 历史回合没有实时耗时：null 而不是 0（曾经渲染成"耗时 0ms"）
      current.status = "done";
      current.durationMs = null;
      current.attachments = parseUserAttachments(m.metadata ?? null);
      turns.push(current);
    } else if (current) {
      const snapshot = parseTurnSnapshot(m.metadata ?? null);
      if (snapshot) {
        restoreTurn(current, m.content, snapshot);
      } else {
        current.parts.push({ kind: "text", text: m.content });
        current.text = m.content;
        current.status = "done";
      }
      if (m.promptTokens !== undefined || m.completionTokens !== undefined) {
        current.tokens = { input: m.promptTokens ?? 0, output: m.completionTokens ?? 0 };
      }
    }
  }
  return turns;
}

/**
 * 用快照恢复一轮（就地写 turn）：
 * 文本段只存了字符数，按序从消息正文切片；切片总长与正文不一致时，剩余部分补成
 * 末尾文本段（自愈，绝不吞字）。
 */
export function restoreTurn(turn: Turn, content: string, snapshot: TurnSnapshot): void {
  turn.text = content;
  turn.tools = snapshot.tools.map((c) => ({ ...c }));
  turn.notes = snapshot.notes.map((n) => ({ ...n }));
  turn.references = snapshot.references.map((r) => ({ ...r }));
  turn.questions = snapshot.questions.map((q) => ({
    ...q,
    options: q.options.map((o) => ({ ...o })),
  }));
  turn.todos = snapshot.todos.map((t) => ({ ...t }));
  turn.warnings = [...snapshot.warnings];
  turn.changedDocuments = [...snapshot.changedDocuments];
  turn.requestId = snapshot.requestId;
  turn.durationMs = snapshot.durationMs;
  turn.status = snapshot.errorMessage ? "error" : "done";
  turn.errorMessage = snapshot.errorMessage ?? undefined;

  const parts: TurnPart[] = [];
  let offset = 0;
  for (const part of snapshot.parts) {
    if (part.kind !== "text") {
      parts.push({ ...part });
      continue;
    }
    const text = content.slice(offset, offset + part.chars);
    offset += part.chars;
    if (!text) continue;
    const last = parts[parts.length - 1];
    if (last && last.kind === "text") last.text += text;
    else parts.push({ kind: "text", text });
  }
  // 正文比快照记录的文本段长（如中止路径的快照偏差）：补尾段，不丢字
  if (offset < content.length) {
    const rest = content.slice(offset);
    const last = parts[parts.length - 1];
    if (last && last.kind === "text") last.text += rest;
    else parts.push({ kind: "text", text: rest });
  }
  turn.parts = parts;
}

/** 把某张确认卡标记为已解决（渲染为"已删除/已移动"的收尾行） */
export function markNoteResolved(
  turns: Turn[],
  kind: "delete_confirm" | "move_confirm",
  noteId: string,
): Turn[] {
  let changed = false;
  const next = turns.map((t) => {
    if (!t.notes.some((n) => n.kind === kind && n.noteId === noteId && !n.resolved)) return t;
    changed = true;
    return {
      ...t,
      notes: t.notes.map((n) =>
        n.kind === kind && n.noteId === noteId ? { ...n, resolved: true } : n,
      ),
    };
  });
  return changed ? next : turns;
}

/**
 * 待确认删除的文档 id（去重）。
 * 用途：刷新后用"文档是否还在"对账 —— 已确认删除的文档不在了，卡片就该显示为已删除，
 * 而不是重新弹一张点了必然报错的"确认永久删除"（元数据不写回，靠事实对账）。
 */
export function pendingDeleteIds(turns: Turn[]): string[] {
  const ids = new Set<string>();
  for (const turn of turns) {
    for (const note of turn.notes) {
      if (note.kind === "delete_confirm" && !note.resolved) ids.add(note.noteId);
    }
  }
  return [...ids];
}

/** 回填提问卡的回答（卡片随之变为不可再答，避免重复提交同一问题） */export function markQuestionAnswered(
  turns: Turn[],
  turnId: string,
  index: number,
  answer: string,
): Turn[] {
  return turns.map((t) => {
    if (t.id !== turnId) return t;
    return {
      ...t,
      questions: t.questions.map((q, i) => (i === index ? { ...q, answered: answer } : q)),
    };
  });
}

// ---- 发送队列：按会话取件，绝不跨会话发送/渲染 ----

export interface QueuedMessage {
  /** 稳定 key（同内容多条也不撞） */
  id: string;
  content: string;
  /** 入队时的会话快照：切回该会话才会发出 */
  sessionId: string;
}

export function createQueuedMessage(content: string, sessionId: string): QueuedMessage {
  return { id: crypto.randomUUID(), content, sessionId };
}

export function enqueue(queue: QueuedMessage[], item: QueuedMessage): QueuedMessage[] {
  return [...queue, item];
}

export function removeQueueAt(queue: QueuedMessage[], index: number): QueuedMessage[] {
  return queue.filter((_, i) => i !== index);
}

/**
 * 要不要自动发送队列里的下一条（纯函数，便于单测）：
 * - 正在生成中：不动（等本轮结束）
 * - 用户刚点过「停止生成」：**不自动续发**（中止的语义就是"停下来"，
 *   否则用户会看到"点了中断它又自己开始思考"，误以为中断无效）
 * - 当前会话没有待发消息：不动
 */
export function shouldDispatchQueued(
  gate: { streaming: boolean; suppressed: boolean },
  queue: QueuedMessage[],
  sessionId: string | null,
): boolean {
  if (gate.streaming || gate.suppressed) return false;
  return takeNextForSession(queue, sessionId).item !== null;
}

/**
 * 取出该会话最早的一条待发消息。
 * 返回 rest 而不仅是新数组：调用方需要拿到 rest 与 item 两个结果。
 */
export function takeNextForSession(
  queue: QueuedMessage[],
  sessionId: string | null,
): { item: QueuedMessage | null; rest: QueuedMessage[] } {
  if (!sessionId) return { item: null, rest: queue };
  const index = queue.findIndex((q) => q.sessionId === sessionId);
  if (index < 0) return { item: null, rest: queue };
  return { item: queue[index], rest: queue.filter((_, i) => i !== index) };
}
