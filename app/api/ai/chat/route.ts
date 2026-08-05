import { createClient } from "@/lib/supabase/server";
import { runNoteAgent, type AgentHistoryMessage } from "@/lib/agent";
import { getChatHistory, insertChatMessage } from "@/lib/db";
import { maybeCompressSession, WINDOW_SIZE } from "@/lib/compress";
import { logger } from "@/lib/logger";

/**
 * 请求幂等：靠 chat_messages(userId, requestId) 唯一约束（migration 006），
 * 重复 requestId 落库时触发 23505 冲突 → 409。
 * 相比进程内 Map：Serverless / 多实例部署下数据库约束天然共享，且无内存泄漏。
 */
function isUniqueViolation(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    ((e as { code?: string }).code === "23505" ||
      String((e as { message?: string }).message ?? "").includes("duplicate key"))
  );
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

  const { prompt, sessionId, requestId } = await request.json();
  logger.api.info("收到 AI 请求", { userId: user.id, promptLen: prompt.length, sessionId });

  // 会话归属校验（RLS 兜底，这里显式检查给出清晰错误）
  if (!sessionId) {
    return Response.json({ error: "sessionId is required" }, { status: 400 });
  }
  const { data: session } = await supabase
    .from("chat_sessions")
    .select("id, title, summary")
    .eq("id", sessionId)
    .eq("userId", user.id)
    .single();
  if (!session) {
    return Response.json({ error: "Session not found" }, { status: 404 });
  }

  // 落库用户消息（携带 requestId 作幂等键；冲突=重复请求直接拒绝）。
  // 其他失败不阻塞主流程。
  try {
    await insertChatMessage(supabase, {
      userId: user.id,
      sessionId,
      role: "user",
      content: prompt,
      requestId: requestId || undefined,
    });
  } catch (e) {
    if (isUniqueViolation(e)) {
      logger.api.warn("重复请求已拒绝", { requestId });
      return Response.json({ error: "Duplicate request" }, { status: 409 });
    }
    logger.api.error("用户消息落库失败", { error: String(e) });
  }

  // 首个问题自动命名会话，其余仅刷新 updatedAt（失败不阻塞主流程）
  try {
    const updateFields: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    if (session.title === "新对话") {
      updateFields.title = prompt.slice(0, 20);
    }
    await supabase
      .from("chat_sessions")
      .update(updateFields)
      .eq("id", sessionId);
  } catch (e) {
    logger.api.error("会话更新失败", { error: String(e) });
  }

  // 拉取该会话未压缩的对话历史注入 Agent（滑动窗口：早期对话已压缩为 summary，
  // 注入最近 WINDOW_SIZE 条原文，其余靠摘要承载；压缩见 lib/compress.ts）
  let history: AgentHistoryMessage[] = [];
  try {
    const msgs = await getChatHistory(user.id, sessionId, WINDOW_SIZE, supabase, { uncompressedOnly: true });
    history = msgs.map((m) => ({ role: m.role, content: m.content }));
    logger.api.info("注入对话历史", { count: history.length, hasSummary: !!session.summary });
  } catch (e) {
    logger.api.warn("拉取对话历史失败，本次无上下文", { error: String(e) });
  }

  const { stream, done } = await runNoteAgent(supabase, user.id, prompt, {
    history,
    summary: session.summary || undefined,
    signal: request.signal, // 前端 abort fetch 时中断 DeepSeek 生成
  });

  // 流结束后后台落库 assistant 消息（含 token 统计，PandaWiki 启发），
  // 随后触发上下文压缩检查（未压缩消息超阈值时生成摘要并标记，失败降级不影响主流程）
  const finish = done
    .then((result) =>
      insertChatMessage(supabase, {
        userId: user.id,
        sessionId,
        role: "assistant",
        content: result.text,
        promptTokens: result.usage?.inputTokens ?? 0,
        completionTokens: result.usage?.outputTokens ?? 0,
        totalTokens: (result.usage?.inputTokens ?? 0) + (result.usage?.outputTokens ?? 0),
      })
    )
    .then(() => maybeCompressSession(supabase, user.id, sessionId))
    .catch((e) => {
      logger.api.error("assistant 消息落库失败", { error: String(e) });
    });
  void finish;

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}
