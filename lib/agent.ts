import { streamText } from "ai";
import { deepSeek } from "@ai-sdk/deepseek";
import { stepCountIs } from "ai";
import { NOTE_ASSISTANT_PROMPT } from "./ai-prompts";
import { createTools } from "./ai/tools";
import { getById } from "./db";

function extractText(content: string | null): string {
  if (!content) return "";
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
  userId: string,
  prompt: string,
  documentId?: string,
) {
  const messages: any[] = [];

  if (documentId) {
    const doc = await getById(documentId);
    if (doc) {
      const plainText = extractText(doc.content);
      messages.push({
        role: "user",
        content: `用户正在查看文档「${doc.title}」，内容如下：\n\n${plainText}`,
      });
      messages.push({
        role: "assistant",
        content: "我已阅读了文档内容，请告诉我你需要什么帮助？",
      });
    }
  }

  messages.push({ role: "user", content: prompt });

  return streamText({
    model: deepSeek("deepseek-v4-flash"),
    system: NOTE_ASSISTANT_PROMPT,
    messages,
    tools: createTools(userId),
    stopWhen: stepCountIs(10),
  });
}
