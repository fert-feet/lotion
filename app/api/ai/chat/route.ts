import { createClient } from "@/lib/supabase/server";
import { runNoteAgent } from "@/lib/agent";
import { logger } from "@/lib/logger";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    logger.api.warn("未授权请求");
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { prompt, documentId } = await request.json();
  logger.api.info("收到 AI 请求", { userId: user.id, promptLen: prompt.length, documentId });

  // 服务端查文档（用 server client，有 cookie 认证）
  let docContext: { title: string; content: string } | undefined;
  if (documentId) {
    const { data: doc } = await supabase
      .from("documents")
      .select("title, content")
      .eq("id", documentId)
      .eq("userId", user.id)
      .single();

    if (doc) {
      docContext = { title: doc.title, content: doc.content || "" };
    }
  }

  const result = await runNoteAgent(user.id, prompt, docContext);

  return new Response(result.textStream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
}
