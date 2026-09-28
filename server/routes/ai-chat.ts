// POST /api/ai/chat —— AI 笔记助手 SSE 流端点
// 鉴权：本地会话 cookie → requireAuth 中间件
// 数据：直接使用本地 SQLite 层（lib/local/db.ts），无 RLS，userId 全程显式过滤
import { Hono } from "hono";
import { getDb } from "@/lib/local/sqlite";
import { runNoteAgent, type AgentHistoryMessage } from "@/lib/agent";
import {
  getChatSession,
  getDocumentById,
  listChatHistory,
  insertChatMessage,
  setChatSessionTitle,
  touchChatSession,
} from "@/lib/local/db";
import { maybeCompressSession, WINDOW_SIZE } from "@/lib/compress";
import { logger } from "@/lib/logger";
import { readJson, type AppEnv } from "../http";
import { requireAuth } from "../middleware";
import { getHostAiConfig, getHostKernelIfBooted, getHostTools } from "../kernel";

/**
 * 请求幂等：靠 chat_messages(userId, requestId) 唯一约束（本地版 DDL 同款），
 * 重复 requestId 落库时触发 SQLITE_CONSTRAINT_UNIQUE → 409。
 */
function isUniqueViolation(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    (e as { code?: string }).code === "SQLITE_CONSTRAINT_UNIQUE"
  );
}

export const aiChatRoutes = new Hono<AppEnv>();

aiChatRoutes.use("*", requireAuth);

aiChatRoutes.post("/", async (c) => {
  const user = c.get("user");

  const parsed = await readJson<{
    prompt?: string;
    sessionId?: string;
    requestId?: string;
    documentId?: string;
  }>(c);
  if (!parsed.ok) return c.json({ error: "请求体不是合法 JSON" }, 400);
  const { prompt, sessionId, requestId, documentId } = parsed.data;
  if (!prompt || !sessionId) return c.json({ error: "prompt 与 sessionId 必填" }, 400);
  logger.api.info("收到 AI 请求", { userId: user.id, promptLen: prompt.length, sessionId });

  // 会话归属校验（无 RLS 兜底，这里显式检查给出清晰错误）
  const db = getDb();
  const session = getChatSession(db, user.id, sessionId);
  if (!session) return c.json({ error: "Session not found" }, 404);

  // 落库用户消息（携带 requestId 作幂等键；冲突=重复请求直接拒绝）。其他失败不阻塞主流程。
  try {
    insertChatMessage(db, {
      userId: user.id,
      sessionId,
      role: "user",
      content: prompt,
      requestId: requestId || undefined,
    });
  } catch (e) {
    if (isUniqueViolation(e)) {
      logger.api.warn("重复请求已拒绝", { requestId });
      return c.json({ error: "Duplicate request" }, 409);
    }
    logger.api.error("用户消息落库失败", { error: String(e) });
  }

  // 首个问题自动命名会话，其余仅刷新 updatedAt（失败不阻塞主流程）
  try {
    if (session.title === "新对话") {
      setChatSessionTitle(db, user.id, sessionId, prompt.slice(0, 20));
    } else {
      touchChatSession(db, user.id, sessionId);
    }
  } catch (e) {
    logger.api.error("会话更新失败", { error: String(e) });
  }

  // 拉取该会话未压缩的对话历史注入 Agent（滑动窗口：早期对话已压缩为 summary，
  // 注入最近 WINDOW_SIZE 条原文，其余靠摘要承载；压缩见 lib/compress.ts）
  let history: AgentHistoryMessage[] = [];
  try {
    const msgs = listChatHistory(db, user.id, sessionId, WINDOW_SIZE, { uncompressedOnly: true });
    history = msgs.map((m) => ({ role: m.role, content: m.content }));
    logger.api.info("注入对话历史", { count: history.length, hasSummary: !!session.summary });
  } catch (e) {
    logger.api.warn("拉取对话历史失败，本次无上下文", { error: String(e) });
  }

  // AI 运行期配置来自配置层（env > data/settings.json > 组合默认）；内核未装配时回退环境变量。
  // 每次请求都解析：改模型/key 后**无需重启**即可生效。
  const ai = getHostAiConfig();

  // 当前文档上下文：显式按 userId 校验归属（无 RLS 兜底），拿不到就静默降级为无上下文，
  // 绝不让别的用户的文档标题/id 进 system 提示
  let currentDocument: { id: string; title: string } | undefined;
  if (documentId) {
    try {
      const doc = getDocumentById(db, documentId, user.id);
      if (doc) currentDocument = { id: doc.id, title: doc.title };
    } catch (e) {
      logger.api.warn("当前文档上下文读取失败，忽略", { error: String(e) });
    }
  }

  const { stream, done } = await runNoteAgent(db, user.id, prompt, {
    history,
    summary: session.summary || undefined,
    signal: c.req.raw.signal, // 前端 abort fetch 时中断 DeepSeek 生成
    ai,
    currentDocument,
    // 工具注册表来自内核：插件注册的工具自动对模型可见；未装配内核时回退内置注册表
    tools: getHostKernelIfBooted() ? getHostTools() : undefined,
    context: getHostKernelIfBooted()?.ctx,
  });

  // 流结束后后台落库 assistant 消息（含 token 统计），随后触发上下文压缩检查
  const finish = done
    .then((result) =>
      insertChatMessage(db, {
        userId: user.id,
        sessionId,
        role: "assistant",
        content: result.text,
        promptTokens: result.usage?.inputTokens ?? 0,
        completionTokens: result.usage?.outputTokens ?? 0,
        totalTokens: (result.usage?.inputTokens ?? 0) + (result.usage?.outputTokens ?? 0),
      }),
    )
    .then(() => maybeCompressSession(user.id, sessionId, ai ? { ai } : undefined))
    .catch((e) => {
      logger.api.error("assistant 消息落库失败", { error: String(e) });
    });
  void finish;

  return c.newResponse(stream, 200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
});
