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

  return streamText({
    model: deepSeek("deepseek-v4-flash"),
    system: NOTE_ASSISTANT_PROMPT,
    messages,
    tools: createTools(supabase, userId),
    stopWhen: stepCountIs(10),
    onStepFinish: ({ text, toolCalls, toolResults, finishReason }) => {
      stepCount++;
      logger.agent.info(`Step ${stepCount} 完成`, {
        finishReason,
        textLen: text?.length ?? 0,
        toolCalls: toolCalls?.map((tc: any) => tc.toolName) ?? [],
        toolResults: Array.isArray(toolResults)
          ? toolResults.map((tr: any) => ({ tool: tr.toolName, ok: !tr.error }))
          : [],
      });
    },
  });
}
