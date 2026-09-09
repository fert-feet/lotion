// GET /api/public/documents/:documentId —— 公开预览专用只读端点（无鉴权）
// 仅返回 isPublished=true 的文档；本地单机语义（D8）：同一机器上的任何人都可看已发布笔记。
// TODO(后期)：公网部署时需重新评估公开面（加访问令牌/分享链接机制）。
import { Hono } from "hono";
import { getDb } from "@/lib/local/sqlite";
import { getDocumentById } from "@/lib/local/db";
import type { AppEnv } from "../http";

export const publicDocumentsRoutes = new Hono<AppEnv>();

publicDocumentsRoutes.get("/:documentId", (c) => {
  const doc = getDocumentById(getDb(), c.req.param("documentId"));
  if (!doc || !doc.isPublished) return c.json({ error: "Not found" }, 404);
  return c.json(doc);
});
