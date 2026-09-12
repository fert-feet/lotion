import { streamText, stepCountIs } from "ai";
import { createAiModel, resolveAiRuntimeConfig, type AiRuntimeConfig } from "@/lib/ai/runtime-config";
import type Database from "better-sqlite3";
import { NOTE_ASSISTANT_PROMPT } from "./ai-prompts";
import {
  createTools,
  createDoomLoopTracker,
  TOOL_META,
  type ToolEvent,
  type ToolName,
} from "./ai/tools";
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

/** Agent 执行结果（route.ts 落库 assistant 消息用） */
export interface AgentResult {
  text: string;
  usage: { inputTokens: number; outputTokens: number } | null;
  references: { noteId: string; title: string }[];
  durationMs: number;
  toolCount: number;
}

/** AI 读取过的笔记（引用来源） */
export type AgentReference = { noteId: string; title: string };

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
    /** AI 运行期配置（来自 settings 配置层）；缺省时回退环境变量 */
    ai?: Partial<AiRuntimeConfig>;
  },
) {
  const ai = resolveAiRuntimeConfig(options?.ai);
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
  // deleteNote/moveNote 已触发确认：onStepFinish 检测到后中止本轮生成，
  // 确认流程挂起等用户确认（前端确认后走 REST 执行）
  let confirmPending = false;
  // 中止句柄：onStepFinish 在 result 返回后才可能触发，此处延迟绑定
  let abortFn: (() => void) | null = null;

  const onToolEvent = (e: ToolEvent) => {
    switch (e.type) {
      case "tool_start":
        toolCount++;
        eventQueue.push({
          type: "tool_start",
          tool: e.tool,
          seq: e.seq,
          label: TOOL_META[e.tool].label,
          argsText: e.argsText,
        });
        break;
      case "tool_end":
        eventQueue.push({
          type: "tool_end",
          tool: e.tool,
          seq: e.seq,
          ok: e.ok,
          summary: e.summary,
          error: e.error,
        });
        break;
      case "note_created":
        eventQueue.push({ type: "note_created", noteId: e.noteId, title: e.title });
        break;
      case "note_modified":
        eventQueue.push({ type: "note_modified", noteId: e.noteId, title: e.title });
        break;
      case "confirm_delete":
        confirmPending = true;
        eventQueue.push({ type: "confirm_delete", noteId: e.noteId, title: e.title });
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
        break;
      case "question":
        eventQueue.push({ type: "question", questions: e.questions });
        break;
      case "todo_update":
        eventQueue.push({ type: "todo_update", items: e.items });
        break;
      case "reference":
        // 流内即时推送（前端直接渲染引用 chip）
        eventQueue.push({ type: "reference", noteId: e.noteId, title: e.title });
        // 同时聚合，供 AgentResult 落库
        if (!references.some((r) => r.noteId === e.noteId)) {
          references.push({ noteId: e.noteId, title: e.title });
        }
        break;
    }
  };

  // done promise：onFinish 时 resolve，route.ts 拿 assistant 全文 + usage 落库。
  // 幂等兜底：abort / 异常路径下 SDK 可能不触发 onFinish，流关闭时也 resolve，
  // 避免 done 悬挂导致 assistant 消息静默不落库。
  let resolveDone: (r: AgentResult) => void = () => {};
  let doneResolved = false;
  const resolveDoneSafe = (r: AgentResult) => {
    if (doneResolved) return;
    doneResolved = true;
    resolveDone(r);
  };
  const done = new Promise<AgentResult>((res) => { resolveDone = res; });
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
    // 上下文压缩：早期对话以摘要形式注入 system（重写式摘要保留语义与文档 id 引用）
    system: options?.summary
      ? `${NOTE_ASSISTANT_PROMPT}\n\n以下是本会话早期对话的摘要（已压缩，细节以摘要为准）：\n${options.summary}`
      : NOTE_ASSISTANT_PROMPT,
    messages,
    // doom loop 检测（对齐 SiYuan）：相同工具+参数连续失败 3 次前端警告、5 次中止
    tools: createTools(db, userId, onToolEvent, createDoomLoopTracker({
      onWarn: (name, count) => {
        logger.agent.warn("doom loop 警告", { name, count });
        eventQueue.push({
          type: "warning",
          message: `检测到 AI 连续 ${count} 次以相同参数调用「${TOOL_META[name].label}」均未成功，请换一种方式操作。`,
        });
      },
      onStop: (name, count) => {
        logger.agent.error("doom loop 终止", { name, count });
        eventQueue.push({
          type: "error",
          message: `检测到重复工具调用（「${TOOL_META[name].label}」连续 ${count} 次相同参数失败），已终止本轮生成。`,
        });
        abortFn?.();
      },
    })),
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
      eventQueue.push({ type: "error", message: error instanceof Error ? error.message : String(error) });
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
      // 兜底 resolve：取消后 done 不悬挂（真实删除由前端确认后执行，此处无需补文本）
      resolveDoneSafe({
        text: "",
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
        // 超时前尽力推送残留事件
        flushFinalEvents(controller);
        controller.close();
        cleanupRef?.();
        return;
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }

      if (done) {
        // 流结束时推送残留事件 + turn_end
        flushFinalEvents(controller);
        controller.close();
        cleanupRef?.();
        // 兜底 resolve（onFinish 通常已触发，此处防 SDK 顺序差异导致 done 悬挂）
        resolveDoneSafe({
          text: "",
          usage: finishUsage,
          references: [...references],
          durationMs: Date.now() - startedAt,
          toolCount,
        });
        return;
      }

      controller.enqueue(sseEvent({ type: "text", text: value ?? "" }));
    },
  });

  return { stream: wrapped, done };
}