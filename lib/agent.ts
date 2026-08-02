import { streamText, stepCountIs } from "ai";
import { deepSeek } from "@ai-sdk/deepseek";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NOTE_ASSISTANT_PROMPT } from "./ai-prompts";
import { createTools, TOOL_LABELS, type ToolEvent } from "./ai/tools";
import { logger } from "./logger";

/** SSE 事件类型（前端 ai-panel.tsx 按 type 分发解析） */
export type AgentStreamEvent =
  | { type: "text"; text: string }
  | { type: "progress"; label: string }
  | { type: "note_created"; noteId: string }
  | { type: "confirm_delete"; noteId: string; title: string }
  | { type: "note_modified"; noteId: string }
  | { type: "references"; references: AgentReference[] }
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
}

/** AI 读取过的笔记（引用来源） */
export type AgentReference = { noteId: string; title: string };

// ---- 配置：集中管理，模型可经环境变量覆盖 ----
const AI_MODEL = process.env.AI_MODEL || "deepseek-v4-flash";
const MAX_STEPS = 5; // Agent 最大工具调用步数
const STREAM_TIMEOUT_MS = 120_000; // 单次流读取超时
const EVENT_POLL_INTERVAL_MS = 200; // 副作用事件轮询间隔（tool 与流层解耦后的兜底唤醒）

const encoder = new TextEncoder();

/** 序列化一条 SSE 事件（data: <json> + 空行） */
function sseEvent(event: AgentStreamEvent): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
}

export async function runNoteAgent(
  supabase: SupabaseClient,
  userId: string,
  prompt: string,
  options?: { history?: AgentHistoryMessage[]; signal?: AbortSignal },
) {
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
  logger.agent.info("开始 Agent 执行", { userId, prompt: prompt.slice(0, 100), historyCount: history.length });

  let stepCount = 0;
  const startedAt = Date.now();
  let stepStart = startedAt;

  // 事件队列：tool 副作用 + progress 统一入队，SSE 包装层轮询取出推送。
  // tool 通过 onEvent 回调上报（见 ToolEvent），不再共享可变对象。
  const eventQueue: AgentStreamEvent[] = [];
  // 引用来源：readNote 等写操作上报后聚合，流结束时一次性推送 references 事件
  const references: AgentReference[] = [];
  // deleteNote 已触发确认：onStepFinish 检测到后中止本轮生成，删除流程挂起等用户确认
  let confirmDeletePending = false;
  // 中止句柄：onStepFinish 在 result 返回后才可能触发，此处延迟绑定
  let abortFn: (() => void) | null = null;

  const onToolEvent = (e: ToolEvent) => {
    switch (e.type) {
      case "note_created":
        eventQueue.push({ type: "note_created", noteId: e.noteId });
        break;
      case "confirm_delete":
        confirmDeletePending = true;
        eventQueue.push({ type: "confirm_delete", noteId: e.noteId, title: e.title });
        break;
      case "note_modified":
        eventQueue.push({ type: "note_modified", noteId: e.noteId });
        break;
      case "reference":
        // 按 noteId 去重：重复 readNote 同一笔记不产生重复徽标
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
    model: deepSeek(AI_MODEL),
    system: NOTE_ASSISTANT_PROMPT,
    messages,
    tools: createTools(supabase, userId, onToolEvent),
    stopWhen: stepCountIs(MAX_STEPS),
    abortSignal: internalAbort.signal, // 前端终止 / deleteNote 确认后中断生成
    onStepFinish: ({ finishReason, toolCalls, text }) => {
      const stepMs = Date.now() - stepStart;
      stepStart = Date.now();
      stepCount++;
      if (toolCalls?.length) {
        const names = toolCalls.map((tc: { toolName: string }) => TOOL_LABELS[tc.toolName] || tc.toolName).join(" → ");
        eventQueue.push({ type: "progress", label: names });
      }
      // deleteNote 触发确认后立即中止本轮生成：避免 AI 在用户确认前
      // 继续调用其他工具造成意外副作用（如先删后建）。
      if (confirmDeletePending && toolCalls?.some((tc: { toolName: string }) => tc.toolName === "deleteNote")) {
        logger.agent.info("deleteNote 已触发确认，中止本轮生成");
        abortFn?.();
      }
      logger.agent.info(`Step ${stepCount} 完成`, {
        finishReason,
        stepMs,
        toolCalls: toolCalls?.map((tc) => ({ name: tc.toolName, args: "args" in tc ? tc.args : undefined })),
        text: text ? (text.length > 200 ? text.slice(0, 200) + "…" : text) : undefined,
        confirmDeletePending,
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
        confirmDeletePending,
        steps: steps?.map((s) => ({ toolCalls: s.toolCalls?.map((tc) => tc.toolName), finishReason: s.finishReason })),
      });
      resolveDoneSafe({
        text: text ?? "",
        usage: finishUsage,
        references: [...references],
      });
    },
  });
  abortFn = () => internalAbort.abort();

  // 包装流：SSE 事件行输出（data: <json>\n\n），事件与文本分通道，前端按行解析
  const textStream = result.textStream;
  const reader = textStream.getReader();

  /** 推送即时事件（progress + 副作用），失败（背压/已关闭）时丢弃并返回 false */
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

  /** 流结束时推送残留事件 + 引用来源（references 一次性汇总） */
  function flushFinalEvents(controller: ReadableStreamDefaultController<Uint8Array>) {
    const ok = flushImmediateEvents(controller);
    if (!ok) return;
    if (references.length > 0) {
      logger.agent.info("推送 references 事件", { count: references.length });
      try {
        controller.enqueue(sseEvent({ type: "references", references: [...references] }));
        references.length = 0;
      } catch {
        // 流已关闭，丢弃
      }
    }
  }

  // 定时器清理句柄：start 里创建，pull 完成 / cancel / 超时兜底三处统一回收
  let cleanupRef: (() => void) | null = null;

  const wrapped = new ReadableStream<Uint8Array>({
    start(controller) {
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
      resolveDoneSafe({ text: "", usage: finishUsage, references: [...references] });
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
        // 流结束时推送残留事件 + 引用来源
        flushFinalEvents(controller);
        controller.close();
        cleanupRef?.();
        // 兜底 resolve（onFinish 通常已触发，此处防 SDK 顺序差异导致 done 悬挂）
        resolveDoneSafe({ text: "", usage: finishUsage, references: [...references] });
        return;
      }

      controller.enqueue(sseEvent({ type: "text", text: value ?? "" }));
    },
  });

  return { stream: wrapped, done };
}
