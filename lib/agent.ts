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
): Promise<{
  stream: ReadableStream<string>;
  noteIds: string[];
}> {
  const messages: any[] = [];
  const createdNoteIds: string[] = [];

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

  const result = streamText({
    model: deepSeek("deepseek-v4-flash"),
    system: NOTE_ASSISTANT_PROMPT,
    messages,
    tools: createTools(supabase, userId, createdNoteIds),
    stopWhen: stepCountIs(10),
    onStepFinish: ({ finishReason }) => {
      stepCount++;
      logger.agent.info(`Step ${stepCount} 完成`, { finishReason });
    },
  });

  const textStream = result.textStream;

  // 如果有新创建的笔记，在流前面插入标记，前端读到后自动跳转
  if (createdNoteIds.length > 0) {
    const prefix = createdNoteIds.map((id) => `[NOTE_CREATED:${id}]`).join("");
    const reader = textStream.getReader();
    let prefixSent = false;
    const combined = new ReadableStream<string>({
      async pull(controller) {
        if (!prefixSent) {
          controller.enqueue(prefix);
          prefixSent = true;
          return;
        }
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
        } else {
          controller.enqueue(value);
        }
      },
    });

    return { stream: combined, noteIds: createdNoteIds };
  }

  return { stream: textStream, noteIds: [] };
}
