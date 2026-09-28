// POST /api/ai/undo —— 撤销某轮 AI 对文档的隐式改动（挂在 /ai 下：/api/ai/undo）
//
// 语义：agent 在**写入前**为每个会被改的文档拍了一份快照（ai_changes 表，按 requestId 分组）。
// 撤销 = 把这些字段恢复回去。覆盖 updateNote/updateBlock/renameNote/setNoteIcon/publishNote/
// archiveNote/restoreNote；用户显式确认过的删除/移动不在其中（确认框本身已是一次确认，
// 且永久删除无法用"恢复字段"表达）。
//
// 幂等：已撤销的改动不再重复恢复（restored: []），前端据此把按钮收起来。
import { Hono } from "hono";
import { getDb } from "@/lib/local/sqlite";
import { listAiChanges, undoAiChanges } from "@/lib/local/db";
import { logger } from "@/lib/logger";
import { readJson, type AppEnv } from "../http";
import { requireAuth } from "../middleware";

export const aiUndoRoutes = new Hono<AppEnv>();

aiUndoRoutes.use("*", requireAuth);

/** POST /api/ai/undo { requestId } —— 恢复该轮改动前的文档状态 */
aiUndoRoutes.post("/", async (c) => {
  const user = c.get("user");
  const parsed = await readJson<{ requestId?: string }>(c);
  if (!parsed.ok) return c.json({ error: "请求体不是合法 JSON" }, 400);
  const requestId = parsed.data.requestId;
  if (!requestId) return c.json({ error: "requestId 必填" }, 400);

  const db = getDb();
  const { restored, skipped } = undoAiChanges(db, user.id, requestId);
  logger.api.info("AI 改动撤销请求", {
    userId: user.id,
    requestId,
    restored: restored.length,
    skipped,
  });
  return c.json({ ok: true, restored, skipped });
});

/** GET /api/ai/undo/:requestId —— 该轮是否还有可撤销的改动（前端按钮态） */
aiUndoRoutes.get("/:requestId", (c) => {
  const user = c.get("user");
  const rows = listAiChanges(getDb(), user.id, c.req.param("requestId"));
  return c.json({ canUndo: rows.length > 0, documents: rows.map((r) => r.documentId) });
});
