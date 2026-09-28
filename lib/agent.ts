import { streamText, stepCountIs } from "ai";
import { createAiModel, resolveAiRuntimeConfig, type AiRuntimeConfig } from "@/lib/ai/runtime-config";
import { buildToolSet } from "@/lib/ai/tools/registry";
import type Database from "better-sqlite3";
import { NOTE_ASSISTANT_PROMPT } from "./ai-prompts";
import { createTurnSnapshot, type TurnSnapshot } from "./chat-snapshot";
import { getDocumentById } from "./local/db";
import {
  createDefaultToolRegistry,
  createDoomLoopTracker,
  type ToolEvent,
  type ToolName,
} from "./ai/tools";
import type { HostToolRegistry } from "./ai/tools/registry";
import { logger } from "./logger";

/**
 * SSE 事件类型（前端 ai-panel 按 type 分发，渲染为 turn 时间线节点）：
 * - turn_start / turn_end：回合边界（turn_end 带耗时与 token 统计，DSH TurnTail 同款）
 * - text：AI 叙述流式增量
 * - tool_start / tool_end：工具调用生命周期（卡片：running → done/error）
 * - note_created / note_modified / confirm_delete / confirm_move / reference：文档副作用事件
 * - question / todo_update：结构化提问（前端选项卡片，回答作为后续消息回传）与会话任务清单
 * - warning：doom loop 重复失败警告（对齐 SiYuan：3 次警告、5 次终止）
 * - error：生成中途出错
 */
export type AgentStreamEvent =
  | { type: "turn_start"; turn: number; startedAt: string }
  | { type: "text"; text: string }
  | { type: "tool_start"; tool: ToolName; seq: number; label: string; argsText: string }
  | { type: "tool_end"; tool: ToolName; seq: number; ok: boolean; summary: string; error?: string }
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
  | { type: "question"; questions: Array<{ header: string; question: string; options: Array<{ label: string; description: string }>; multiple?: boolean; custom?: boolean }> }
  | { type: "todo_update"; items: Array<{ content: string; status: "pending" | "in_progress" | "completed" | "cancelled" }> }
  | { type: "reference"; noteId: string; title: string }
  | { type: "warning"; message: string }
  | { type: "turn_end"; turn: number; durationMs: number; tokens: { input: number; output: number } | null }
  | { type: "error"; message: string };

/** 注入到 Agent 的对话历史消息 */
export interface AgentHistoryMessage {
  role: "user" | "assistant";
  content: string;
}

/** 当前文档上下文（前端把用户正在看的文档带进来，省掉"再 @ 一次"） */
export interface AgentCurrentDocument {
  id: string;
  title: string;
}

/**
 * 组装系统提示词：基础提示 + 早期对话摘要 + 当前文档上下文。
 * 抽成导出函数是为了能直接断言"当前文档确实进了 system"（而不是只测调用参数）。
 */
export function buildSystemPrompt(options?: {
  summary?: string;
  currentDocument?: AgentCurrentDocument;
}): string {
  let system = NOTE_ASSISTANT_PROMPT;
  // 上下文压缩：早期对话以摘要形式注入（重写式摘要保留语义与文档 id 引用）
  if (options?.summary) {
    system += `\n\n以下是本会话早期对话的摘要（已压缩，细节以摘要为准）：\n${options.summary}`;
  }
  if (options?.currentDocument) {
    const { id, title } = options.currentDocument;
    system +=
      `\n\n【当前文档】用户此刻正在查看「${title || "无标题"}」（id: ${id}）。` +
      `用户说"这篇 / 当前文档 / 它 / 这里"时默认指这篇：需要内容时先 readNote 读取，` +
      `不要只凭标题猜测；修改优先用 updateBlock 精确改块，避免整篇覆盖。`;
  }
  return system;
}

/** Agent 执行结果（route.ts 落库 assistant 消息用） */
export interface AgentResult {
  text: string;
  usage: { inputTokens: number; outputTokens: number } | null;
  references: { noteId: string; title: string }[];
  durationMs: number;
  toolCount: number;
  /** 本轮被 AI 改写的文档及其**改动前**状态（撤销用） */
  changes: AgentChange[];
  /** 本轮结构化快照（落库用：刷新后重建工具卡/副作用卡/引用/待办/提问） */
  snapshot: TurnSnapshot;
}

/** AI 读取过的笔记（引用来源） */
export type AgentReference = { noteId: string; title: string };

/** 一次 AI 写入前的文档快照（撤销 = 恢复这些字段） */
export interface AgentChange {
  documentId: string;
  before: {
    title: string;
    content: string | null;
    icon: string | null;
    coverImage: string | null;
    parentDocument: string | null;
    isPublished: boolean;
    isArchived: boolean;
  };
}

/**
 * 会**写文档**的内置工具（deleteNote/moveNote 走用户确认后的 REST，不在此列）。
 * 约定：这些工具的入参都带 `noteId`。
 */
const MUTATING_TOOLS = new Set([
  "updateNote",
  "updateBlock",
  "renameNote",
  "setNoteIcon",
  "publishNote",
  "archiveNote",
  "restoreNote",
]);

/** 从工具入参里取文档 id（改写入参名时这里会失效 —— 有单测钉住） */
export function mutatingDocumentId(tool: string, args: unknown): string | null {
  if (!MUTATING_TOOLS.has(tool)) return null;
  if (typeof args !== "object" || args === null) return null;
  const noteId = (args as { noteId?: unknown }).noteId;
  return typeof noteId === "string" && noteId ? noteId : null;
}

// ---- 配置：模型/Key 每次调用时从配置层解析（见 lib/ai/runtime-config.ts）----
const MAX_STEPS = 5; // Agent 最大工具调用步数
const STREAM_TIMEOUT_MS = 120_000; // 单次流读取超时
const EVENT_POLL_INTERVAL_MS = 200; // 副作用事件轮询间隔（tool 与流层解耦后的兜底唤醒）

const encoder = new TextEncoder();

/** 序列化一条 SSE 事件（data: <json> + 空行） */
function sseEvent(event: AgentStreamEvent): Uint8Array {
  return encoder.encode("data: " + JSON.stringify(event) + "\n\n");
}

export async function runNoteAgent(
  db: Database.Database,
  userId: string,
  prompt: string,
  options?: {
    history?: AgentHistoryMessage[];
    summary?: string;
    signal?: AbortSignal;
    /** 用户当前正在查看的文档（进 system 提示，支持"这篇/它"这类指代） */
    currentDocument?: AgentCurrentDocument;
    /** AI 运行期配置（来自 settings 配置层）；缺省时回退环境变量 */
    ai?: Partial<AiRuntimeConfig>;
    /**
     * 工具注册表（来自宿主内核的 tools 服务）。
     * 缺省时用内置注册表 —— 于是"插件注册的工具"只在装配了内核的运行时可见。
     */
    tools?: HostToolRegistry;
    /** 内核上下文（自指类工具用：plugin_* 等） */
    context?: unknown;
  },
) {
  const ai = resolveAiRuntimeConfig(options?.ai);
  const toolRegistry = options?.tools ?? createDefaultToolRegistry();
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [];

  // 注入全部对话历史（多轮上下文让 AI 记住之前的问答，
  // 多轮指代如"那篇""再详细点"不需要重新 search + read）。
  // 全量注入：不做条数/字符预算/截断，模型上下文窗口内完整保留早期信息。
  const history = options?.history ?? [];
  for (const h of history) {
    messages.push({ role: h.role, content: h.content });
  }
  if (history.length > 0) {
    logger.agent.info("注入对话历史", { count: history.length });
  }

  messages.push({ role: "user", content: prompt });
  logger.agent.info("开始 Agent 执行", {
    userId,
    prompt: prompt.slice(0, 100),
    historyCount: history.length,
    hasSummary: !!options?.summary,
    model: ai.model,
    hasApiKey: ai.apiKey !== "",
  });

  let stepCount = 0;
  let toolCount = 0;
  const startedAt = Date.now();
  let stepStart = startedAt;
  const turn = 1; // 单请求单回合

  // 事件队列：tool 事件 + 副作用统一入队，SSE 包装层轮询取出推送
  const eventQueue: AgentStreamEvent[] = [];
  // 引用来源：tool 上报后聚合，落库用（流内已即时推送）
  const references: AgentReference[] = [];
  // 写入前快照（撤销用）：按文档去重，保留**最早**那份（首次改动前的状态）
  const changes: AgentChange[] = [];
  // 本轮结构化快照：与 SSE 事件**同序**累积（文本段只记字符数，正文走 chat_messages.content）。
  // 前端实时渲染走 SSE，刷新/切会话时用这份快照重建同一条时间线。
  const snapshot = createTurnSnapshot();
  /** 追加文本段（连续 chunk 合并，与前端 reducer 的合并规则一致） */
  const snapshotText = (chars: number) => {
    if (chars <= 0) return;
    const last = snapshot.parts[snapshot.parts.length - 1];
    if (last && last.kind === "text") last.chars += chars;
    else snapshot.parts.push({ kind: "text", chars });
  };
  /** 待确认卡去重（AI 可能重复调用同一工具） */
  const hasPendingConfirm = (
    kind: "delete_confirm" | "move_confirm",
    noteId: string,
  ): boolean =>
    snapshot.notes.some((n) => n.kind === kind && n.noteId === noteId && !n.resolved);
  // deleteNote/moveNote 已触发确认：onStepFinish 检测到后中止本轮生成，
  // 确认流程挂起等用户确认（前端确认后走 REST 执行）
  let confirmPending = false;
  // 中止句柄：onStepFinish 在 result 返回后才可能触发，此处延迟绑定
  let abortFn: (() => void) | null = null;

  const onToolEvent = (e: ToolEvent) => {
    switch (e.type) {
      case "tool_start": {
        toolCount++;
        // 写入前拍快照（"撤销本次改动"）：趁工具还没执行，把文档当前状态存下来
        const changedId = mutatingDocumentId(e.tool, e.args);
        if (changedId && !changes.some((c) => c.documentId === changedId)) {
          try {
            const doc = getDocumentById(db, changedId, userId);
            if (doc) {
              changes.push({
                documentId: doc.id,
                before: {
                  title: doc.title,
                  content: doc.content,
                  icon: doc.icon,
                  coverImage: doc.coverImage,
                  parentDocument: doc.parentDocument,
                  isPublished: doc.isPublished,
                  isArchived: doc.isArchived,
                },
              });
            }
          } catch (err) {
            logger.agent.warn("改动前快照失败，本轮该文档不可撤销", {
              documentId: changedId,
              error: String(err),
            });
          }
        }
        const label = toolRegistry.get(e.tool)?.label ?? e.tool;
        eventQueue.push({
          type: "tool_start",
          tool: e.tool,
          seq: e.seq,
          label,
          argsText: e.argsText,
        });
        snapshot.tools.push({
          seq: e.seq,
          tool: e.tool,
          label,
          argsText: e.argsText,
          state: "running",
          summary: "",
        });
        snapshot.parts.push({ kind: "tool", seq: e.seq });
        break;
      }
      case "tool_end": {
        eventQueue.push({
          type: "tool_end",
          tool: e.tool,
          seq: e.seq,
          ok: e.ok,
          summary: e.summary,
          error: e.error,
        });
        const card = snapshot.tools.find((c) => c.seq === e.seq);
        if (card) {
          card.state = e.ok ? "done" : "error";
          card.summary = e.summary;
          card.error = e.ok ? undefined : e.error;
        }
        break;
      }
      case "note_created":
        eventQueue.push({ type: "note_created", noteId: e.noteId, title: e.title });
        snapshot.notes.push({ kind: "created", noteId: e.noteId, title: e.title });
        snapshot.parts.push({ kind: "note", index: snapshot.notes.length - 1 });
        break;
      case "note_modified":
        eventQueue.push({ type: "note_modified", noteId: e.noteId, title: e.title });
        snapshot.notes.push({ kind: "modified", noteId: e.noteId, title: e.title });
        snapshot.parts.push({ kind: "note", index: snapshot.notes.length - 1 });
        break;
      case "confirm_delete":
        confirmPending = true;
        eventQueue.push({ type: "confirm_delete", noteId: e.noteId, title: e.title });
        if (!hasPendingConfirm("delete_confirm", e.noteId)) {
          snapshot.notes.push({
            kind: "delete_confirm",
            noteId: e.noteId,
            title: e.title,
            resolved: false,
          });
          snapshot.parts.push({ kind: "note", index: snapshot.notes.length - 1 });
        }
        break;
      case "confirm_move":
        confirmPending = true;
        eventQueue.push({
          type: "confirm_move",
          noteId: e.noteId,
          title: e.title,
          targetTitle: e.targetTitle,
          toRoot: e.toRoot,
        });
        if (!hasPendingConfirm("move_confirm", e.noteId)) {
          snapshot.notes.push({
            kind: "move_confirm",
            noteId: e.noteId,
            title: e.title,
            targetTitle: e.targetTitle,
            toRoot: e.toRoot,
            resolved: false,
          });
          snapshot.parts.push({ kind: "note", index: snapshot.notes.length - 1 });
        }
        break;
      case "question":
        eventQueue.push({ type: "question", questions: e.questions });
        for (const q of e.questions) {
          snapshot.questions.push({ ...q });
          snapshot.parts.push({ kind: "question", index: snapshot.questions.length - 1 });
        }
        break;
      case "todo_update":
        eventQueue.push({ type: "todo_update", items: e.items });
        snapshot.todos = e.items.map((i) => ({ ...i }));
        if (!snapshot.parts.some((p) => p.kind === "todo")) snapshot.parts.push({ kind: "todo" });
        break;
      case "reference":
        // 流内即时推送（前端直接渲染引用 chip）
        eventQueue.push({ type: "reference", noteId: e.noteId, title: e.title });
        // 同时聚合，供 AgentResult 落库
        if (!references.some((r) => r.noteId === e.noteId)) {
          references.push({ noteId: e.noteId, title: e.title });
          snapshot.references.push({ noteId: e.noteId, title: e.title });
        }
        break;
    }
  };

  // done promise：onFinish 时 resolve，route.ts 拿 assistant 全文 + usage 落库。
  // 幂等兜底：abort / 异常路径下 SDK 可能不触发 onFinish，流关闭时也 resolve，
  // 避免 done 悬挂导致 assistant 消息静默不落库。
  let resolveDone: (r: AgentResult) => void = () => {};
  let doneResolved = false;
  const resolveDoneSafe = (r: Omit<AgentResult, "snapshot" | "changes">) => {
    if (doneResolved) return;
    doneResolved = true;
    // 快照的耗时与结果同源（历史重建时 footer 才不会显示"耗时 0ms"）
    snapshot.durationMs = r.durationMs;
    snapshot.changedDocuments = changes.map((c) => c.documentId);
    resolveDone({ ...r, snapshot, changes });
  };
  const done = new Promise<AgentResult>((res) => { resolveDone = res; });
  // 已推送的叙述文本累计：中止/异常路径下用它落库"已生成的部分"。
  // 背景：AI SDK 在 abort 时走 onAbort、**不走 onFinish**，此前 fallback 一律 resolve
  // 空字符串 —— 用户点"停止生成"后已生成的内容会丢（甚至落一条空 assistant 消息）。
  let accumulatedText = "";
  // onFinish 的 usage（onFinish 与流 done 的先后不保证，用变量桥接）
  let finishUsage: { inputTokens: number; outputTokens: number } | null = null;

  // 程序化中止（deleteNote 触发确认后中断本轮生成）：
  // 内部 AbortController 与前端 signal 联动，streamText 统一监听
  const internalAbort = new AbortController();
  if (options?.signal) {
    if (options.signal.aborted) {
      internalAbort.abort();
    } else {
      options.signal.addEventListener("abort", () => internalAbort.abort(), { once: true });
    }
  }

  const result = streamText({
    model: createAiModel(ai),
    // 系统提示：基础提示 + 早期对话摘要 + 当前文档上下文
    system: buildSystemPrompt({ summary: options?.summary, currentDocument: options?.currentDocument }),
    messages,
    // doom loop 检测（对齐 SiYuan）：相同工具+参数连续失败 3 次前端警告、5 次中止
    tools: buildToolSet(toolRegistry, {
      db,
      userId,
      onEvent: onToolEvent,
      context: options?.context,
      doom: createDoomLoopTracker({
      onWarn: (name, count) => {
        logger.agent.warn("doom loop 警告", { name, count });
        const message = `检测到 AI 连续 ${count} 次以相同参数调用「${toolRegistry.get(name)?.label ?? name}」均未成功，请换一种方式操作。`;
        eventQueue.push({ type: "warning", message });
        snapshot.warnings.push(message);
        snapshot.parts.push({ kind: "warning", index: snapshot.warnings.length - 1 });
      },
      onStop: (name, count) => {
        logger.agent.error("doom loop 终止", { name, count });
        const message = `检测到重复工具调用（「${toolRegistry.get(name)?.label ?? name}」连续 ${count} 次相同参数失败），已终止本轮生成。`;
        eventQueue.push({ type: "error", message });
        snapshot.errorMessage = message;
        abortFn?.();
      },
      }),
    }),
    stopWhen: stepCountIs(MAX_STEPS),
    abortSignal: internalAbort.signal, // 前端终止 / deleteNote/moveNote 确认后中断生成
    onStepFinish: ({ finishReason, toolCalls }) => {
      const stepMs = Date.now() - stepStart;
      stepStart = Date.now();
      stepCount++;
      // deleteNote / moveNote 触发确认后立即中止本轮生成：避免 AI 在用户确认前
      // 继续调用其他工具造成意外副作用（如先删后建、先移后改）。
      const confirmTool = (tc: { toolName: string }) =>
        tc.toolName === "deleteNote" || tc.toolName === "moveNote";
      if (confirmPending && toolCalls?.some(confirmTool)) {
        logger.agent.info("确认类工具已触发，中止本轮生成");
        abortFn?.();
      }
      logger.agent.info(`Step ${stepCount} 完成`, {
        finishReason,
        stepMs,
        toolCalls: toolCalls?.map((tc) => ({ name: tc.toolName, args: "args" in tc ? tc.args : undefined })),
        confirmPending,
      });
    },
    onError: ({ error }) => {
      // 生成中途出错（如模型 API 异常）：推送 error 事件让前端明确提示，而非静默断流
      logger.agent.error("Agent 执行出错", { error: String(error) });
      const message = error instanceof Error ? error.message : String(error);
      eventQueue.push({ type: "error", message });
      snapshot.errorMessage = message;
    },
    onAbort: () => {
      // 用户停止 / 确认类工具中止生成：立刻用已累计文本收尾（onFinish 不会触发）
      logger.agent.info("生成被中止，落库已生成的部分内容", { textLen: accumulatedText.length });
      resolveDoneSafe({
        text: accumulatedText,
        usage: finishUsage,
        references: [...references],
        durationMs: Date.now() - startedAt,
        toolCount,
      });
    },
    onFinish: ({ finishReason, usage, text, steps }) => {
      finishUsage = usage
        ? { inputTokens: usage.inputTokens ?? 0, outputTokens: usage.outputTokens ?? 0 }
        : null;
      logger.agent.info("Agent 执行结束", {
        finishReason,
        totalSteps: stepCount,
        totalMs: Date.now() - startedAt,
        usage: finishUsage,
        textLen: text?.length ?? 0,
        referenceCount: references.length,
        confirmPending,
        steps: steps?.map((s) => ({ toolCalls: s.toolCalls?.map((tc) => tc.toolName), finishReason: s.finishReason })),
      });
      resolveDoneSafe({
        text: text ?? "",
        usage: finishUsage,
        references: [...references],
        durationMs: Date.now() - startedAt,
        toolCount,
      });
    },
  });
  abortFn = () => internalAbort.abort();

  // 包装流：SSE 事件行输出（data: <json>\n\n），事件与文本分通道，前端按行解析
  const textStream = result.textStream;
  const reader = textStream.getReader();

  /** 推送即时事件，失败（背压/已关闭）时丢弃并返回 false */
  function flushImmediateEvents(controller: ReadableStreamDefaultController<Uint8Array>): boolean {
    try {
      while (eventQueue.length > 0) {
        controller.enqueue(sseEvent(eventQueue.shift()!));
      }
      return true;
    } catch {
      return false; // 背压或流已关闭：放弃剩余事件
    }
  }

  /** 流结束时推送残留事件 + turn_end（耗时 / token 统计） */
  function flushFinalEvents(controller: ReadableStreamDefaultController<Uint8Array>) {
    const ok = flushImmediateEvents(controller);
    if (!ok) return;
    try {
      controller.enqueue(sseEvent({
        type: "turn_end",
        turn,
        durationMs: Date.now() - startedAt,
        tokens: finishUsage ? { input: finishUsage.inputTokens, output: finishUsage.outputTokens } : null,
      }));
    } catch {
      // 流已关闭，丢弃
    }
  }

  // 定时器清理句柄：start 里创建，pull 完成 / cancel / 超时兜底三处统一回收
  let cleanupRef: (() => void) | null = null;

  const wrapped = new ReadableStream<Uint8Array>({
    start(controller) {
      // 回合开始事件（前端据此初始化 turn 状态）
      try {
        controller.enqueue(sseEvent({ type: "turn_start", turn, startedAt: new Date(startedAt).toISOString() }));
      } catch {
        // 流已关闭，忽略
      }
      // 定时轮询事件队列，有消息就立即推送（不等文本 chunk）
      const interval = setInterval(() => {
        flushImmediateEvents(controller);
      }, EVENT_POLL_INTERVAL_MS);
      let cleaned = false;
      cleanupRef = () => {
        if (cleaned) return;
        cleaned = true;
        clearInterval(interval);
      };
      // ReadableStream 没有 close 回调，用 setTimeout 兜底
      setTimeout(() => cleanupRef?.(), STREAM_TIMEOUT_MS + 5000);
    },
    cancel() {
      // 外部取消（前端 abort / 客户端断开）时回收定时器，避免泄漏
      cleanupRef?.();
      // 兜底 resolve：取消后 done 不悬挂，并保留已生成的部分内容
      resolveDoneSafe({
        text: accumulatedText,
        usage: finishUsage,
        references: [...references],
        durationMs: Date.now() - startedAt,
        toolCount,
      });
    },
    async pull(controller) {
      // 先推送待处理的进度与副作用事件（保证事件先于后续文本）
      flushImmediateEvents(controller);

      let done: boolean | undefined;
      let value: string | undefined;

      // 可取消的超时：race 后清理定时器，避免长流下每个 chunk 累积 120s 存活定时器
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error("STREAM_TIMEOUT")), STREAM_TIMEOUT_MS);
      });

      try {
        const result = await Promise.race([reader.read(), timeout]);
        done = result.done;
        value = result.value;
      } catch (e: unknown) {
        if ((e as { message?: string })?.message === "STREAM_TIMEOUT") {
          logger.agent.warn("流读取超时，强制关闭");
        }
        // 超时/读取异常：尽力推送残留事件，并用已累计文本兜底 resolve（不落空消息）
        flushFinalEvents(controller);
        controller.close();
        cleanupRef?.();
        resolveDoneSafe({
          text: accumulatedText,
          usage: finishUsage,
          references: [...references],
          durationMs: Date.now() - startedAt,
          toolCount,
        });
        return;
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }

      if (done) {
        // 流结束时推送残留事件 + turn_end
        flushFinalEvents(controller);
        controller.close();
        cleanupRef?.();
        // 兜底 resolve（onFinish 通常已触发，此处防 SDK 顺序差异导致 done 悬挂；
        // 用累计文本而不是空串，避免"onFinish 晚于流关闭"时把回答写成空消息）
        resolveDoneSafe({
          text: accumulatedText,
          usage: finishUsage,
          references: [...references],
          durationMs: Date.now() - startedAt,
          toolCount,
        });
        return;
      }

      accumulatedText += value ?? "";
      snapshotText((value ?? "").length);
      controller.enqueue(sseEvent({ type: "text", text: value ?? "" }));
    },
  });

  return { stream: wrapped, done };
}