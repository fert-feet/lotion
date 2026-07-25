import { streamText } from "ai";
import { deepSeek } from "@ai-sdk/deepseek";
import { stepCountIs } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NOTE_ASSISTANT_PROMPT } from "./ai-prompts";
import { createTools } from "./ai/tools";
import { logger } from "./logger";

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

  messages.push({ role: "user", content: prompt });
  logger.agent.info("开始 Agent 执行", { userId, prompt: prompt.slice(0, 100), withContext: !!docContext });

  let stepCount = 0;
  // 共享变量：createNote tool 创建后写入 ID，流读取时检测并注入标记
  const pendingNoteId: { current: string | null } = { current: null };
  // 共享变量：deleteNote tool 触发确认，等待用户在前端确认
  const pendingConfirmDelete: { current: { noteId: string; title: string } | null } = { current: null };

  const result = streamText({
    model: deepSeek("deepseek-v4-flash"),
    system: NOTE_ASSISTANT_PROMPT,
    messages,
    tools: createTools(supabase, userId, pendingNoteId, pendingConfirmDelete),
    stopWhen: stepCountIs(10),
    onStepFinish: ({ finishReason }) => {
      stepCount++;
      logger.agent.info(`Step ${stepCount} 完成`, {
        finishReason,
        pendingNoteId: pendingNoteId.current,
        pendingConfirmDelete: pendingConfirmDelete.current?.noteId,
      });
    },
  });

  // 包装流：每次读取时检查是否有待注入的 noteId
  // 使用 TextEncoder 确保产出 Uint8Array（Response 构造函数要求）
  const textStream = result.textStream;
  const reader = textStream.getReader();
  const encoder = new TextEncoder();

  const wrapped = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read();

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
        controller.close();
        return;
      }

      // tool 执行中产生了 noteId / confirmDelete，注入到当前 chunk 前面
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
      controller.enqueue(encoder.encode(chunk));
    },
  });

  return { stream: wrapped };
}
