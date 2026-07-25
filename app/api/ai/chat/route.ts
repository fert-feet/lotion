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

  const result = await runNoteAgent(user.id, prompt, documentId);

  return new Response(result.textStream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
}
