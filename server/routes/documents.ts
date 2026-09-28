// /api/documents/* —— 文档 CRUD / 归档 / 恢复 / 移动
// 迁移自 app/api/documents/*（Next.js 动态段 [documentId] → Hono :documentId）
import { Hono } from "hono";
import { getDb } from "@/lib/local/sqlite";
import {
  archiveDocument,
  createDocument,
  deleteDocument,
  getDescendantIds,
  getDocumentById,
  listSearch,
  listSidebarAll,
  listTrash,
  moveDocument,
  restoreDocument,
  updateDocument,
} from "@/lib/local/db";
import { readJson, type AppEnv } from "../http";
import { requireAuth } from "../middleware";
import { appendMarkdownToDocument } from "@/lib/content-server";

const UPDATEABLE_FIELDS = [
  "title",
  "content",
  "coverImage",
  "icon",
  "isPublished",
  "isDraft",
] as const;

export const documentsRoutes = new Hono<AppEnv>();

// 全部文档端点都需要登录会话
documentsRoutes.use("*", requireAuth);

/** GET /api/documents?scope=sidebar|trash|search —— 列表 */
documentsRoutes.get("/", (c) => {
  const user = c.get("user");
  const scope = c.req.query("scope") ?? "sidebar";
  const db = getDb();
  if (scope === "trash") return c.json(listTrash(db, user.id));
  if (scope === "search") return c.json(listSearch(db, user.id));
  return c.json(listSidebarAll(db, user.id));
});

/** POST /api/documents —— 创建文档 */
documentsRoutes.post("/", async (c) => {
  const user = c.get("user");
  const parsed = await readJson<{ title?: string; parentDocument?: string | null }>(c);
  if (!parsed.ok) return c.json({ error: "请求体不是合法 JSON" }, 400);
  const { title, parentDocument } = parsed.data;
  if (!title || typeof title !== "string") return c.json({ error: "title 必填" }, 400);

  const id = createDocument(getDb(), user.id, title, parentDocument ?? null);
  return c.json({ id });
});

/** GET /api/documents/:documentId —— 单文档 */
documentsRoutes.get("/:documentId", (c) => {
  const user = c.get("user");
  const doc = getDocumentById(getDb(), c.req.param("documentId"), user.id);
  if (!doc) return c.json({ error: "Not found" }, 404);
  return c.json(doc);
});

/** PATCH /api/documents/:documentId —— 更新（字段白名单） */
documentsRoutes.patch("/:documentId", async (c) => {
  const parsed = await readJson<Record<string, unknown>>(c);
  if (!parsed.ok) return c.json({ error: "请求体不是合法 JSON" }, 400);

  // 白名单过滤：未列字段一律丢弃（防越权改 userId / isArchived 等）
  const fields: Record<string, unknown> = {};
  for (const key of UPDATEABLE_FIELDS) {
    if (key in parsed.data) fields[key] = parsed.data[key];
  }

  updateDocument(getDb(), c.req.param("documentId"), fields as never);
  return c.json({ ok: true });
});

/** DELETE /api/documents/:documentId —— 永久删除 */
documentsRoutes.delete("/:documentId", (c) => {
  deleteDocument(getDb(), c.req.param("documentId"));
  return c.json({ ok: true });
});

/** 单次追加的 Markdown 上限（防一次把回答灌爆库；前端按钮也只传一轮回答） */
const APPEND_MAX_CHARS = 20_000;

/**
 * POST /api/documents/:documentId/append —— 追加 Markdown 到文档末尾。
 * AI 面板的「插入到当前文档」：回答是 Markdown，而库里正文是 BlockNote JSON，
 * 转换放服务端（@blocknote/server-util），客户端只发原文。
 */
documentsRoutes.post("/:documentId/append", async (c) => {
  const user = c.get("user");
  const documentId = c.req.param("documentId");

  const parsed = await readJson<{ markdown?: string }>(c);
  if (!parsed.ok) return c.json({ error: "请求体不是合法 JSON" }, 400);
  const markdown = parsed.data.markdown;
  if (typeof markdown !== "string" || !markdown.trim()) {
    return c.json({ error: "markdown 必填" }, 400);
  }
  if (markdown.length > APPEND_MAX_CHARS) {
    return c.json({ error: `内容超过 ${APPEND_MAX_CHARS} 字符上限` }, 413);
  }

  const db = getDb();
  const doc = getDocumentById(db, documentId, user.id);
  if (!doc) return c.json({ error: "文档不存在或无权访问" }, 404);
  if (doc.isArchived) return c.json({ error: "文档已归档，先恢复再插入" }, 400);

  const content = await appendMarkdownToDocument(doc.content, markdown, { maxChars: APPEND_MAX_CHARS });
  updateDocument(db, documentId, { content });
  return c.json({ ok: true });
});

/** PATCH /api/documents/:documentId/archive —— 递归归档子树 */
documentsRoutes.patch("/:documentId/archive", (c) => {
  const user = c.get("user");
  archiveDocument(getDb(), user.id, c.req.param("documentId"));
  return c.json({ ok: true });
});

/** PATCH /api/documents/:documentId/restore —— 递归恢复子树 */
documentsRoutes.patch("/:documentId/restore", (c) => {
  const user = c.get("user");
  restoreDocument(getDb(), user.id, c.req.param("documentId"));
  return c.json({ ok: true });
});

/**
 * PUT /api/documents/:documentId/move —— 移动文档（null = 移到根目录）。
 * 与 AI moveNote 工具配合：工具只发确认请求，用户确认后经本端点真正执行。
 * 目标父文档必须存在、属于当前用户且未归档；防循环引用（不能移到自身或子孙下）。
 */
documentsRoutes.put("/:documentId/move", async (c) => {
  const user = c.get("user");
  const documentId = c.req.param("documentId");

  const parsed = await readJson<{ parentDocument?: string | null }>(c);
  if (!parsed.ok) return c.json({ error: "body 必须是 JSON" }, 400);
  const newParentId = parsed.data.parentDocument ?? null;

  const existing = getDocumentById(getDb(), documentId, user.id);
  if (!existing) return c.json({ error: "文档不存在或无权访问" }, 404);

  if (newParentId !== null) {
    const target = getDocumentById(getDb(), newParentId, user.id);
    if (!target) return c.json({ error: "目标父文档不存在或无权访问" }, 400);
    if (target.isArchived) return c.json({ error: "目标父文档已归档" }, 400);
    if (getDescendantIds(getDb(), user.id, documentId).includes(newParentId)) {
      return c.json({ error: "不能移动到自身或其子文档下（循环引用）" }, 400);
    }
  }

  if (!moveDocument(getDb(), user.id, documentId, newParentId)) {
    return c.json({ error: "移动失败" }, 400);
  }
  return c.json({ ok: true, parentDocument: newParentId });
});
