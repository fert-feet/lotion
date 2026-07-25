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

  const { stream } = await runNoteAgent(supabase, user.id, prompt, docContext);

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
}
