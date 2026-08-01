import { streamText } from "ai";
import { deepSeek } from "@ai-sdk/deepseek";
import { stepCountIs } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NOTE_ASSISTANT_PROMPT } from "./ai-prompts";
import { createTools } from "./ai/tools";
import { logger } from "./logger";

const TOOL_LABELS: Record<string, string> = {
  searchNotes: "🔍 搜索笔记",
  readNote: "📖 读取笔记",
  createNote: "✍️ 创建笔记",
  updateNote: "📝 更新内容",
  renameNote: "🏷️ 重命名",
  archiveNote: "📦 归档",
  deleteNote: "🗑️ 删除",
};

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

const HISTORY_LIMIT = 20; // 注入的历史消息条数上限
const HISTORY_MSG_LIMIT = 2000; // 单条历史消息截断长度

function extractText(content: string): string {
  try {
    const blocks = JSON.parse(content);
    if (!Array.isArray(blocks)) return content;
    return blocks
      .map((b: any) => b.content?.map((c: any) => c.text || "").join("") || "")
      .filter(Boolean)
      .join("\n");
  } catch {
    return content;
  }
}

export async function runNoteAgent(
  supabase: SupabaseClient,
  userId: string,
  prompt: string,
  docContext?: { title: string; content: string },
  options?: { history?: AgentHistoryMessage[] },
) {
  const messages: any[] = [];

  if (docContext) {
    const plainText = extractText(docContext.content);
    logger.agent.info("注入文档上下文", { title: docContext.title, chars: plainText.length });
    messages.push({
      role: "user",
      content: `用户正在查看文档「${docContext.title}」，内容如下：\n\n${plainText}`,
    });
    messages.push({
      role: "assistant",
      content: "我已阅读了文档内容，请告诉我你需要什么帮助？",
    });
  }

  // 注入对话历史（PandaWiki 启发：多轮上下文让 AI 记住之前的问答，
  // 多轮指代如"那篇""再详细点"不再需要重新 search + read）
  const history = (options?.history ?? []).slice(-HISTORY_LIMIT);
  for (const h of history) {
    messages.push({ role: h.role, content: h.content.slice(0, HISTORY_MSG_LIMIT) });
  }
  if (history.length > 0) {
    logger.agent.info("注入对话历史", { count: history.length });
  }

  messages.push({ role: "user", content: prompt });
  logger.agent.info("开始 Agent 执行", { userId, prompt: prompt.slice(0, 100), withContext: !!docContext, historyCount: history.length });

  let stepCount = 0;
  const startedAt = Date.now();
  let stepStart = startedAt;
  // 共享变量：createNote tool 创建后写入 ID，流读取时检测并注入标记
  const pendingNoteId: { current: string | null } = { current: null };
  // 共享变量：deleteNote tool 触发确认，等待用户在前端确认
  const pendingConfirmDelete: { current: { noteId: string; title: string } | null } = { current: null };
  // 共享变量：updateNote / renameNote 修改了文档，前端需要刷新
  const pendingModifiedNoteId: { current: string | null } = { current: null };
  // 进度队列：onStepFinish 写入，定时器轮询直接 enqueue 到流
  const progressQueue: string[] = [];
  // 引用来源：readNote 读取成功后写入，流结束时注入 [REFERENCES:...] 标记
  const references: AgentReference[] = [];
  // done promise：onFinish 时 resolve，route.ts 拿 assistant 全文 + usage 落库
  let resolveDone: (r: AgentResult) => void = () => {};
  const done = new Promise<AgentResult>((res) => { resolveDone = res; });
  // onFinish 的 usage（onFinish 与流 done 的先后不保证，用变量桥接）
  let finishUsage: { inputTokens: number; outputTokens: number } | null = null;

  const result = streamText({
    model: deepSeek("deepseek-v4-flash"),
    system: NOTE_ASSISTANT_PROMPT,
    messages,
    tools: createTools(supabase, userId, pendingNoteId, pendingConfirmDelete, pendingModifiedNoteId, references),
    stopWhen: stepCountIs(5),
    onStepFinish: ({ finishReason, toolCalls, text }) => {
      const stepMs = Date.now() - stepStart;
      stepStart = Date.now();
      stepCount++;
      if (toolCalls?.length) {
        const names = toolCalls.map((tc: any) => {
          const label = TOOL_LABELS[tc.toolName] || tc.toolName;
          return label;
        }).join(" → ");
        progressQueue.push(`[PROGRESS:${names}]`);
      }
      logger.agent.info(`Step ${stepCount} 完成`, {
        finishReason,
        stepMs,
        toolCalls: toolCalls?.map((tc: any) => ({ name: tc.toolName, args: tc.args })),
        text: text ? (text.length > 200 ? text.slice(0, 200) + "…" : text) : undefined,
        pendingNoteId: pendingNoteId.current,
        pendingConfirmDelete: pendingConfirmDelete.current?.noteId,
        pendingModifiedNoteId: pendingModifiedNoteId.current,
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
        pendingNoteId: pendingNoteId.current,
        pendingModifiedNoteId: pendingModifiedNoteId.current,
        steps: steps?.map((s) => ({ toolCalls: s.toolCalls?.map((tc) => tc.toolName), finishReason: s.finishReason })),
      });
      resolveDone({
        text: text ?? "",
        usage: finishUsage,
        references: [...references],
      });
    },
  });

  // 包装流：每次读取时检查是否有待注入的 noteId
  // 使用 TextEncoder 确保产出 Uint8Array（Response 构造函数要求）
  const textStream = result.textStream;
  const reader = textStream.getReader();
  const encoder = new TextEncoder();
  const STREAM_TIMEOUT_MS = 120_000; // 单次读取超时 120 秒

  const wrapped = new ReadableStream<Uint8Array>({
    start(controller) {
      // 定时轮询进度队列，有消息就立即推送（不等文本 chunk）
      const interval = setInterval(() => {
        while (progressQueue.length > 0) {
          try {
            controller.enqueue(encoder.encode(progressQueue.shift()!));
          } catch {
            break; // 背压，下一轮再试
          }
        }
      }, 300);
      // 流关闭时清理定时器
      let cleaned = false;
      const cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        clearInterval(interval);
      };
      // ReadableStream 没有 close 回调，用 setTimeout 兜底
      setTimeout(() => cleanup(), STREAM_TIMEOUT_MS + 5000);
    },
    cancel() {
      // 外部取消时清理（暂不实现自动清理以保持简洁）
    },
    async pull(controller) {
      let done: boolean | undefined;
      let value: string | undefined;

      try {
        const result = await Promise.race([
          reader.read(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("STREAM_TIMEOUT")), STREAM_TIMEOUT_MS)
          ),
        ]);
        done = result.done;
        value = result.value;
      } catch (e: any) {
        if (e?.message === "STREAM_TIMEOUT") {
          logger.agent.warn("流读取超时，强制关闭");
        }
        // 超时前注入所有待处理标记
        if (pendingNoteId.current) {
          const marker = `[NOTE_CREATED:${pendingNoteId.current}]`;
          controller.enqueue(encoder.encode(marker));
          pendingNoteId.current = null;
        }
        if (pendingConfirmDelete.current) {
          const marker = `[CONFIRM_DELETE:${pendingConfirmDelete.current.noteId}:${encodeURIComponent(pendingConfirmDelete.current.title)}]`;
          controller.enqueue(encoder.encode(marker));
          pendingConfirmDelete.current = null;
        }
        if (pendingModifiedNoteId.current) {
          const marker = `[NOTE_MODIFIED:${pendingModifiedNoteId.current}]`;
          controller.enqueue(encoder.encode(marker));
          pendingModifiedNoteId.current = null;
        }
        // 超时前尽力注入引用标记
        if (references.length > 0) {
          const marker = `[REFERENCES:${references.map((r) => `${r.noteId}:${encodeURIComponent(r.title)}`).join("|")}]`;
          controller.enqueue(encoder.encode(marker));
          references.length = 0;
        }
        controller.close();
        return;
      }

      if (done) {
        // 流结束时如果还有待注入的标记，先注入再关闭
        if (pendingNoteId.current) {
          const marker = `[NOTE_CREATED:${pendingNoteId.current}]`;
          logger.agent.info("流结束前注入 NOTE_CREATED 标记", { noteId: pendingNoteId.current });
          controller.enqueue(encoder.encode(marker));
          pendingNoteId.current = null;
        }
        if (pendingConfirmDelete.current) {
          const marker = `[CONFIRM_DELETE:${pendingConfirmDelete.current.noteId}:${encodeURIComponent(pendingConfirmDelete.current.title)}]`;
          logger.agent.info("流结束前注入 CONFIRM_DELETE 标记", { noteId: pendingConfirmDelete.current.noteId });
          controller.enqueue(encoder.encode(marker));
          pendingConfirmDelete.current = null;
        }
        if (pendingModifiedNoteId.current) {
          const marker = `[NOTE_MODIFIED:${pendingModifiedNoteId.current}]`;
          logger.agent.info("流结束前注入 NOTE_MODIFIED 标记", { noteId: pendingModifiedNoteId.current });
          controller.enqueue(encoder.encode(marker));
          pendingModifiedNoteId.current = null;
        }
        // 流结束前注入引用来源标记（readNote 读过的笔记）
        if (references.length > 0) {
          const marker = `[REFERENCES:${references.map((r) => `${r.noteId}:${encodeURIComponent(r.title)}`).join("|")}]`;
          logger.agent.info("流结束前注入 REFERENCES 标记", { count: references.length });
          controller.enqueue(encoder.encode(marker));
          references.length = 0;
        }
        controller.close();
        return;
      }

      // tool 执行中产生了 noteId / confirmDelete / modifiedNoteId，注入到当前 chunk 前面
      let chunk = value;
      if (pendingNoteId.current) {
        const marker = `[NOTE_CREATED:${pendingNoteId.current}]`;
        logger.agent.info("流注入 NOTE_CREATED 标记", { noteId: pendingNoteId.current });
        chunk = marker + chunk;
        pendingNoteId.current = null;
      }
      if (pendingConfirmDelete.current) {
        const marker = `[CONFIRM_DELETE:${pendingConfirmDelete.current.noteId}:${encodeURIComponent(pendingConfirmDelete.current.title)}]`;
        logger.agent.info("流注入 CONFIRM_DELETE 标记", { noteId: pendingConfirmDelete.current.noteId });
        chunk = marker + chunk;
        pendingConfirmDelete.current = null;
      }
      if (pendingModifiedNoteId.current) {
        const marker = `[NOTE_MODIFIED:${pendingModifiedNoteId.current}]`;
        logger.agent.info("流注入 NOTE_MODIFIED 标记", { noteId: pendingModifiedNoteId.current });
        chunk = marker + chunk;
        pendingModifiedNoteId.current = null;
      }
      // 注入进度消息
      while (progressQueue.length > 0) {
        chunk = progressQueue.shift()! + chunk;
      }
      controller.enqueue(encoder.encode(chunk));
    },
  });

  return { stream: wrapped, done };
}
