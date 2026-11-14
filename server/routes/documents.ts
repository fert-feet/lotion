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
  searchDocuments,
  listDocumentVersions,
  getDocumentVersion,
  restoreDocumentVersion,
  listSearch,
  listSidebarAll,
  listTrash,
  moveDocument,
  restoreDocument,
  updateDocument,
} from "@/lib/local/db";
import { readJson, type AppEnv } from "../http";
import { requireAuth } from "../middleware";
import { appendMarkdownToDocument, toMarkdown } from "@/lib/content-server";

const UPDATEABLE_FIELDS = [
  "title",
  "content",
  "coverImage",
  "icon",
  "isDraft",
] as const;

export const documentsRoutes = new Hono<AppEnv>();

// 全部文档端点都需要登录会话
documentsRoutes.use("*", requireAuth);

/**
 * GET /api/documents?scope=sidebar|trash|search —— 列表
 * scope=search 且带 q 时走 FTS5 全文检索（标题+正文，中文 ≥3 字走索引），
 * 返回 `{ id, title, updatedAt }` 精简项；不带 q 时保持旧行为（返回全部候选，客户端过滤）。
 */
documentsRoutes.get("/", (c) => {
  const user = c.get("user");
  const scope = c.req.query("scope") ?? "sidebar";
  const db = getDb();
  if (scope === "trash") return c.json(listTrash(db, user.id));
  if (scope === "search") {
    const q = (c.req.query("q") ?? "").trim();
    if (!q) return c.json(listSearch(db, user.id));
    return c.json(
      searchDocuments(db, user.id, q, 20).map((d) => ({
        id: d.id,
        title: d.title,
        updatedAt: d.updatedAt,
      })),
    );
  }
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

/**
 * GET /api/documents/:documentId/export?format=md —— 导出 Markdown
 * 数据可迁移是笔记类产品的基本承诺（toMarkdown 已有，导出几乎零成本）。
 * 文件名用 RFC 6266 的 filename* 传 UTF-8，中文标题不会乱码。
 */
documentsRoutes.get("/:documentId/export", async (c) => {
  const user = c.get("user");
  const doc = getDocumentById(getDb(), c.req.param("documentId"), user.id);
  if (!doc) return c.json({ error: "Not found" }, 404);

  const format = c.req.query("format") ?? "md";
  if (format !== "md") return c.json({ error: "仅支持 format=md" }, 400);

  const body = await toMarkdown(doc.content);
  const title = doc.title || "无标题";
  const filename = `${title.replace(/[\\/:*?"<>|]/g, "-")}.md`;
  c.header("Content-Type", "text/markdown; charset=utf-8");
  c.header(
    "Content-Disposition",
    `attachment; filename="${encodeURIComponent(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
  );
  return c.body(`# ${title}\n\n${body}`);
});

/** PATCH /api/documents/:documentId —— 更新（字段白名单） */
documentsRoutes.patch("/:documentId", async (c) => {
  const user = c.get("user");
  const parsed = await readJson<Record<string, unknown>>(c);
  if (!parsed.ok) return c.json({ error: "请求体不是合法 JSON" }, 400);

  // 白名单过滤：未列字段一律丢弃（防越权改 userId / isArchived 等）
  const fields: Record<string, unknown> = {};
  for (const key of UPDATEABLE_FIELDS) {
    if (key in parsed.data) fields[key] = parsed.data[key];
  }

  const db = getDb();
  const documentId = c.req.param("documentId");
  // 归属校验：非本人一律 404（与 GET /:documentId 同型，不泄露文档是否存在）
  if (!getDocumentById(db, documentId, user.id)) {
    return c.json({ error: "Not found" }, 404);
  }
  // 第二层保险：updateDocument 的 SQL 同样带 userId 过滤
  updateDocument(db, user.id, documentId, fields as never);
  return c.json({ ok: true });
});

/** DELETE /api/documents/:documentId —— 永久删除 */
documentsRoutes.delete("/:documentId", (c) => {
  const user = c.get("user");
  const db = getDb();
  const documentId = c.req.param("documentId");
  // 归属校验：非本人一律 404（与 GET /:documentId 同型，不泄露文档是否存在）
  if (!getDocumentById(db, documentId, user.id)) {
    return c.json({ error: "Not found" }, 404);
  }
  // 第二层保险：deleteDocument 的 SQL 同样带 userId 过滤
  deleteDocument(db, user.id, documentId);
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
  updateDocument(db, user.id, documentId, { content });
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
 * GET /api/documents/:documentId/versions —— 版本时间线（新→旧，不含正文）
 */
documentsRoutes.get("/:documentId/versions", (c) => {
  const user = c.get("user");
  const documentId = c.req.param("documentId");
  const doc = getDocumentById(getDb(), documentId, user.id);
  if (!doc) return c.json({ error: "Not found" }, 404);
  return c.json({ versions: listDocumentVersions(getDb(), user.id, documentId) });
});

/**
 * GET /api/documents/:documentId/versions/:versionId —— 单个版本全文（预览用）
 */
documentsRoutes.get("/:documentId/versions/:versionId", (c) => {
  const user = c.get("user");
  const version = getDocumentVersion(
    getDb(),
    user.id,
    c.req.param("documentId"),
    c.req.param("versionId"),
  );
  if (!version) return c.json({ error: "Not found" }, 404);
  return c.json(version);
});

/**
 * POST /api/documents/:documentId/versions/:versionId/restore —— 回滚到该版本
 * 回滚也是一次编辑：当前状态会先被记成一份新版本，回滚错了可以再滚回来。
 */
documentsRoutes.post("/:documentId/versions/:versionId/restore", (c) => {
  const user = c.get("user");
  const documentId = c.req.param("documentId");
  const ok = restoreDocumentVersion(getDb(), user.id, documentId, c.req.param("versionId"));
  if (!ok) return c.json({ error: "版本不存在或回滚失败" }, 404);
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
