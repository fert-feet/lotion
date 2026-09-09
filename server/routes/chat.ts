// /api/chat/sessions/* —— AI 会话与消息
import { Hono } from "hono";
import { getDb } from "@/lib/local/sqlite";
import {
  createChatSession,
  deleteChatSession,
  listChatHistory,
  listChatSessions,
} from "@/lib/local/db";
import { readJson, type AppEnv } from "../http";
import { requireAuth } from "../middleware";

export const chatRoutes = new Hono<AppEnv>();

chatRoutes.use("*", requireAuth);

/** GET /api/chat/sessions —— 会话列表 */
chatRoutes.get("/", (c) => {
  const user = c.get("user");
  return c.json(listChatSessions(getDb(), user.id));
});

/** POST /api/chat/sessions —— 新建会话 */
chatRoutes.post("/", async (c) => {
  const user = c.get("user");
  const parsed = await readJson<{ title?: string }>(c);
  const title = parsed.ok ? parsed.data.title : undefined; // body 非法时按默认标题创建（与原实现一致）
  const id = createChatSession(getDb(), user.id, title || "新对话");
  return c.json({ id });
});

/** DELETE /api/chat/sessions/:sessionId —— 删除会话（消息级联删除） */
chatRoutes.delete("/:sessionId", (c) => {
  const user = c.get("user");
  deleteChatSession(getDb(), user.id, c.req.param("sessionId"));
  return c.json({ ok: true });
});

/** GET /api/chat/sessions/:sessionId/messages?limit=N —— 会话对话历史 */
chatRoutes.get("/:sessionId/messages", (c) => {
  const user = c.get("user");
  const limitRaw = c.req.query("limit");
  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;
  return c.json(
    listChatHistory(
      getDb(),
      user.id,
      c.req.param("sessionId"),
      Number.isFinite(limit) ? limit : undefined,
    ),
  );
});
