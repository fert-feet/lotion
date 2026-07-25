import { streamText } from "ai";
import { deepSeek } from "@ai-sdk/deepseek";
import { createClient } from "@/lib/supabase/server";
import { NOTE_ASSISTANT_PROMPT } from "@/lib/ai-prompts";

function extractBlockNoteText(content: string | null): string {
  if (!content) return "";
  try {
    const blocks = JSON.parse(content);
    if (!Array.isArray(blocks)) return content;
    return blocks
      .map((block: any) => {
        if (block.content && Array.isArray(block.content)) {
          return block.content.map((c: any) => c.text || "").join("");
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  } catch {
    return content;
  }
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { prompt, documentId } = await request.json();

  let contextMessage = "";
  if (documentId) {
    const { data: doc } = await supabase
      .from("documents")
      .select("title, content")
      .eq("id", documentId)
      .eq("userId", user.id)
      .single();

    if (doc) {
      const plainText = extractBlockNoteText(doc.content);
      contextMessage = `用户正在查看文档「${doc.title}」，内容如下：\n\n${plainText}`;
    }
  }

  const messages: any[] = [];

  if (contextMessage) {
    messages.push({ role: "user", content: contextMessage });
    messages.push({
      role: "assistant",
      content: "我已阅读了文档内容，请告诉我你需要什么帮助？",
    });
  }

  messages.push({ role: "user", content: prompt });

  const result = streamText({
    model: deepSeek("deepseek-v4-flash"),
    system: NOTE_ASSISTANT_PROMPT,
    messages,
  });

  // AI SDK v7: use textStream to get a ReadableStream of plain text
  return new Response(result.textStream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
}
