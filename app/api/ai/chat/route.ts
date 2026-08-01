import { createClient } from "@/lib/supabase/server";
import { runNoteAgent, type AgentHistoryMessage } from "@/lib/agent";
import { getChatHistory, insertChatMessage } from "@/lib/db";
import { logger } from "@/lib/logger";

// 请求幂等：requestId → 处理时间戳，10 分钟内重复请求直接拒绝
// （PandaWiki 启发：nonce 防重放，防止前端重试/重复点击造成重复写库）
const processedRequests = new Map<string, number>();
const IDEMPOTENCY_TTL_MS = 10 * 60 * 1000;

function isDuplicateRequest(requestId: string): boolean {
  const now = Date.now();
  // 顺带清理过期条目
  for (const [id, ts] of processedRequests) {
    if (now - ts > IDEMPOTENCY_TTL_MS) processedRequests.delete(id);
  }
  if (processedRequests.has(requestId)) return true;
  processedRequests.set(requestId, now);
  return false;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    logger.api.warn("未授权请求");
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { prompt, documentId, requestId } = await request.json();
  logger.api.info("收到 AI 请求", { userId: user.id, promptLen: prompt.length, documentId });

  // 幂等检查：重复的 requestId 直接拒绝
  if (requestId) {
    if (isDuplicateRequest(requestId)) {
      logger.api.warn("重复请求已拒绝", { requestId });
      return Response.json({ error: "Duplicate request" }, { status: 409 });
    }
  }

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

  // 落库用户消息（失败不阻塞主流程）
  try {
    await insertChatMessage(supabase, {
      userId: user.id,
      documentId: documentId ?? null,
      role: "user",
      content: prompt,
    });
  } catch (e) {
    logger.api.error("用户消息落库失败", { error: String(e) });
  }

  // 拉取该文档的对话历史注入 Agent（多轮上下文）
  let history: AgentHistoryMessage[] = [];
  try {
    const msgs = await getChatHistory(user.id, documentId ?? null, 20, supabase);
    history = msgs.map((m) => ({ role: m.role, content: m.content }));
    logger.api.info("注入对话历史", { count: history.length });
  } catch (e) {
    logger.api.warn("拉取对话历史失败，本次无上下文", { error: String(e) });
  }

  const { stream, done } = await runNoteAgent(supabase, user.id, prompt, docContext, { history });

  // 流结束后后台落库 assistant 消息（含 token 统计，PandaWiki 启发）
  const finish = done
    .then((result) =>
      insertChatMessage(supabase, {
        userId: user.id,
        documentId: documentId ?? null,
        role: "assistant",
        content: result.text,
        promptTokens: result.usage?.inputTokens ?? 0,
        completionTokens: result.usage?.outputTokens ?? 0,
        totalTokens: (result.usage?.inputTokens ?? 0) + (result.usage?.outputTokens ?? 0),
      })
    )
    .catch((e) => {
      logger.api.error("assistant 消息落库失败", { error: String(e) });
    });
  void finish;

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
}
