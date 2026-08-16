"use client";

// AI 面板 turn 时间线状态模型（对齐 DSH 会话节点设计）：
// 一轮用户输入 = 一个 Turn，内含叙述文本（流式）、工具卡片、文档副作用卡片、引用、回合 footer。

/** SSE 事件（与 lib/agent.ts 的 AgentStreamEvent 一一对应） */
export type SseEvent =
  | { type: "turn_start"; turn: number; startedAt: string }
  | { type: "text"; text: string }
  | { type: "tool_start"; tool: string; seq: number; label: string; argsText: string }
  | { type: "tool_end"; tool: string; seq: number; ok: boolean; summary: string; error?: string }
  | { type: "note_created"; noteId: string; title: string }
  | { type: "note_modified"; noteId: string; title: string }
  | { type: "confirm_delete"; noteId: string; title: string }
  | { type: "reference"; noteId: string; title: string }
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
}

export type NoteEvent =
  | { kind: "created"; noteId: string; title: string }
  | { kind: "modified"; noteId: string; title: string }
  | { kind: "delete_confirm"; noteId: string; title: string; resolved: boolean };

export interface Reference { noteId: string; title: string }

export interface Turn {
  /** 会话内自增（新轮次） */
  id: string;
  userContent: string;
  /** 叙述文本（流式累加） */
  text: string;
  tools: ToolCardState[];
  notes: NoteEvent[];
  references: Reference[];
  status: "running" | "done" | "error";
  durationMs: number | null;
  tokens: { input: number; output: number } | null;
  createdAt: number;
}

export function createTurn(userContent: string): Turn {
  return {
    id: crypto.randomUUID(),
    userContent,
    text: "",
    tools: [],
    notes: [],
    references: [],
    status: "running",
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
