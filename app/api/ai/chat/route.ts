import { createClient } from "@/lib/supabase/server";
import { runNoteAgent } from "@/lib/agent";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { prompt, documentId } = await request.json();

  const result = await runNoteAgent(user.id, prompt, documentId);

  return new Response(result.textStream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
}
