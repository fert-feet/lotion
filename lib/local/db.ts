// ⚠️ 服务端专用模块（better-sqlite3 原生模块，禁止客户端导入）。
// 本地版数据访问层：与 lib/db.ts 的 20 个函数一一对应，行为保持一致。
// 差异：函数同步执行（better-sqlite3 同步 API）、db 实例作为首个参数注入（单测用 :memory:）、
// 所有查询显式带 userId 过滤（本地版无 RLS，安全边界在此）。
//
// lib/db.ts（浏览器可用）未来经环境分派调用本模块（server 直查）或 /api/*（client fetch），
// 见 T6；本模块本身只面向服务端。

import type Database from "better-sqlite3";
import { isoNow, newId } from "./sqlite";

// ---- 类型（与 lib/db.ts 保持一致，避免上层组件感知差异） ----
export type Document = {
  id: string;
  title: string;
  userId: string;
  isArchived: boolean;
  isDraft: boolean;
  parentDocument: string | null;
  content: string | null;
  coverImage: string | null;
  icon: string | null;
  isPublished: boolean;
  createdAt: string;
  updatedAt: string;
};

export type SidebarDocument = Omit<Document, "content" | "coverImage">;

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
};

export type ChatSession = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export type ChatMessageInput = {
  userId: string;
  sessionId?: string | null;
  role: "user" | "assistant";
  content: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  requestId?: string;
};

// ---- 行映射：SQLite INTEGER(0/1) → JS boolean，字段裁剪到上层类型 ----
type DocumentRow = Omit<Document, "isArchived" | "isDraft" | "isPublished"> & {
  isArchived: number;
  isDraft: number;
  isPublished: number;
};

function rowToDocument(r: DocumentRow): Document {
  return { ...r, isArchived: !!r.isArchived, isDraft: !!r.isDraft, isPublished: !!r.isPublished };
}

const DOCUMENT_COLUMNS =
  `id, title, userId, isArchived, isDraft, parentDocument, content, coverImage, icon, isPublished, createdAt, updatedAt`;
const SIDEBAR_COLUMNS =
  `id, title, userId, isArchived, isDraft, parentDocument, icon, isPublished, createdAt, updatedAt`;

// ---- AI 会话 ----

/** 列出当前用户全部会话（按最近更新倒序，最多 50 条，与 lib/db.ts 一致） */
export function listChatSessions(db: Database.Database, userId: string, limit = 50): ChatSession[] {
  return db
    .prepare(
      `SELECT id, title, createdAt, updatedAt FROM chat_sessions
       WHERE userId = ? ORDER BY updatedAt DESC LIMIT ?`,
    )
    .all(userId, limit) as ChatSession[];
}

/** 新建会话，返回新会话 id */
export function createChatSession(db: Database.Database, userId: string, title = "新对话"): string {
  const id = newId();
  const now = isoNow();
  db.prepare(
    `INSERT INTO chat_sessions (id, userId, title, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)`,
  ).run(id, userId, title, now, now);
  return id;
}

/** 删除会话（消息经 FK 级联删除） */
export function deleteChatSession(db: Database.Database, userId: string, sessionId: string): void {
  db.prepare(`DELETE FROM chat_sessions WHERE id = ? AND userId = ?`).run(sessionId, userId);
}

/**
 * 拉取会话对话历史（按 createdAt 升序注入模型）。
 * uncompressedOnly：只取未被压缩标记的消息（压缩检查用，与 lib/db.ts 一致）。
 */
export function listChatHistory(
  db: Database.Database,
  userId: string,
  sessionId: string,
  limit?: number,
  opts: { uncompressedOnly?: boolean } = {},
): ChatMessage[] {
  let sql = `SELECT id, role, content, createdAt FROM chat_messages WHERE userId = ? AND sessionId = ?`;
  const params: (string | number)[] = [userId, sessionId];
  if (opts.uncompressedOnly) {
    sql += ` AND compressed = 0`;
  }
  sql += ` ORDER BY createdAt ASC, rowid ASC`;
  if (limit !== undefined) {
    sql += ` LIMIT ?`;
    params.push(limit);
  }
  return db.prepare(sql).all(...params) as ChatMessage[];
}

/** 读取会话压缩摘要 */
export function getChatSessionSummary(
  db: Database.Database,
  userId: string,
  sessionId: string,
): string | null {
  const row = db
    .prepare(`SELECT summary FROM chat_sessions WHERE id = ? AND userId = ?`)
    .get(sessionId, userId) as { summary: string | null } | undefined;
  return row?.summary ?? null;
}

/** 重写式更新会话压缩摘要 */
export function setChatSessionSummary(
  db: Database.Database,
  userId: string,
  sessionId: string,
  summary: string,
): void {
  db.prepare(`UPDATE chat_sessions SET summary = ?, updatedAt = ? WHERE id = ? AND userId = ?`).run(
    summary,
    isoNow(),
    sessionId,
    userId,
  );
}

/** 批量标记消息已压缩 */
export function markMessagesCompressed(db: Database.Database, userId: string, ids: string[]): void {
  if (ids.length === 0) return;
  const mark = db.prepare(`UPDATE chat_messages SET compressed = 1 WHERE id = ? AND userId = ?`);
  const tx = db.transaction(() => {
    for (const id of ids) mark.run(id, userId);
  });
  tx();
}

/**
 * 落库一条聊天消息（user/assistant 通用）。
 * requestId 重复时抛出 SQLITE_CONSTRAINT_UNIQUE（对应 PG 的 23505，上层按 409 处理）。
 */
export function insertChatMessage(db: Database.Database, input: ChatMessageInput): void {
  db.prepare(
    `INSERT INTO chat_messages
       (id, userId, sessionId, role, content, promptTokens, completionTokens, totalTokens, requestId, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    newId(),
    input.userId,
    input.sessionId ?? null,
    input.role,
    input.content,
    input.promptTokens ?? 0,
    input.completionTokens ?? 0,
    input.totalTokens ?? 0,
    input.requestId ?? null,
    isoNow(),
  );
}

// ---- 文档 ----

/** 侧边栏全量文档（未归档，createdAt 倒序，不含 content/coverImage） */
export function listSidebarAll(db: Database.Database, userId: string): SidebarDocument[] {
  const rows = db
    .prepare(
      `SELECT ${SIDEBAR_COLUMNS} FROM documents
       WHERE userId = ? AND isArchived = 0 ORDER BY createdAt DESC`,
    )
    .all(userId) as DocumentRow[];
  return rows.map(rowToDocument).map(({ content: _c, coverImage: _cv, ...rest }) => rest);
}

/** @deprecated 使用 listSidebarAll 替代（保持与 lib/db.ts 相同的废弃函数） */
export function listSidebar(
  db: Database.Database,
  userId: string,
  parentDocument?: string | null,
): Document[] {
  if (parentDocument) {
    return (
      db
        .prepare(
          `SELECT ${DOCUMENT_COLUMNS} FROM documents
           WHERE userId = ? AND isArchived = 0 AND parentDocument = ? ORDER BY createdAt DESC`,
        )
        .all(userId, parentDocument) as DocumentRow[]
    ).map(rowToDocument);
  }
  return (
    db
      .prepare(
        `SELECT ${DOCUMENT_COLUMNS} FROM documents
         WHERE userId = ? AND isArchived = 0 AND parentDocument IS NULL ORDER BY createdAt DESC`,
      )
      .all(userId) as DocumentRow[]
  ).map(rowToDocument);
}

/** 回收站（已归档文档） */
export function listTrash(db: Database.Database, userId: string): SidebarDocument[] {
  const rows = db
    .prepare(
      `SELECT ${SIDEBAR_COLUMNS} FROM documents
       WHERE userId = ? AND isArchived = 1 ORDER BY createdAt DESC`,
    )
    .all(userId) as DocumentRow[];
  return rows.map(rowToDocument).map(({ content: _c, coverImage: _cv, ...rest }) => rest);
}

/** 全局搜索候选（与 lib/db.ts 一致：取未归档全量，关键字过滤在客户端 search-command 完成） */
export function listSearch(db: Database.Database, userId: string): SidebarDocument[] {
  return listSidebarAll(db, userId);
}

/**
 * 单文档查询（无缓存；缓存/去重由 lib/db.ts 适配层负责）。
 * userId 可选：本地版无 RLS，需所有权的调用方必须传入 userId 强制校验；
 * 不传仅用于公开预览页（该页自行校验 isPublished）。
 */
export function getDocumentById(
  db: Database.Database,
  documentId: string,
  userId?: string,
): Document | null {
  const row = userId
    ? (db
        .prepare(`SELECT ${DOCUMENT_COLUMNS} FROM documents WHERE id = ? AND userId = ?`)
        .get(documentId, userId) as DocumentRow | undefined)
    : (db.prepare(`SELECT ${DOCUMENT_COLUMNS} FROM documents WHERE id = ?`).get(documentId) as
        | DocumentRow
        | undefined);
  return row ? rowToDocument(row) : null;
}

/** 创建文档，返回新文档 id（与 lib/db.ts 一致） */
export function createDocument(
  db: Database.Database,
  userId: string,
  title: string,
  parentDocument?: string | null,
): string {
  const id = newId();
  const now = isoNow();
  db.prepare(
    `INSERT INTO documents (id, title, userId, isArchived, isDraft, parentDocument, isPublished, createdAt, updatedAt)
     VALUES (?, ?, ?, 0, 0, ?, 0, ?, ?)`,
  ).run(id, title, userId, parentDocument || null, now, now);
  return id;
}

/** 更新文档字段（显式刷 updatedAt；本地版无 PG 触发器） */
export function updateDocument(
  db: Database.Database,
  id: string,
  fields: Partial<
    Pick<Document, "title" | "content" | "coverImage" | "icon" | "isPublished" | "isDraft">
  >,
): void {
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [k, v] of Object.entries(fields)) {
    sets.push(`"${k}" = ?`);
    // SQLite INTEGER 列不能绑定 JS boolean，显式转 0/1
    params.push(typeof v === "boolean" ? (v ? 1 : 0) : v);
  }
  if (sets.length === 0) return;
  sets.push(`"updatedAt" = ?`);
  params.push(isoNow(), id);
  db.prepare(`UPDATE documents SET ${sets.join(", ")} WHERE id = ?`).run(...params);
}

/**
 * 归档文档及其整棵子树。
 * PG 版递归逐条查询，本地版用递归 CTE 一次完成（语义相同：子树按 userId 过滤）。
 */
export function archiveDocument(db: Database.Database, userId: string, id: string): void {
  db.prepare(
    `WITH RECURSIVE subtree(id) AS (
       SELECT id FROM documents WHERE id = ? AND userId = ?
       UNION ALL
       SELECT d.id FROM documents d JOIN subtree s ON d.parentDocument = s.id WHERE d.userId = ?
     )
     UPDATE documents SET isArchived = 1, updatedAt = ?
     WHERE id IN (SELECT id FROM subtree) AND userId = ?`,
  ).run(id, userId, userId, isoNow(), userId);
}

/**
 * 恢复文档及其整棵子树。
 * 顶层节点若父文档仍处于归档状态则摘除父子关系（detach），与 PG 版语义一致。
 */
export function restoreDocument(db: Database.Database, userId: string, id: string): void {
  const top = db
    .prepare(`SELECT parentDocument FROM documents WHERE id = ? AND userId = ?`)
    .get(id, userId) as { parentDocument: string | null } | undefined;
  if (!top) return;

  const tx = db.transaction(() => {
    db.prepare(
      `WITH RECURSIVE subtree(id) AS (
         SELECT id FROM documents WHERE id = ? AND userId = ?
         UNION ALL
         SELECT d.id FROM documents d JOIN subtree s ON d.parentDocument = s.id WHERE d.userId = ?
       )
       UPDATE documents SET isArchived = 0, updatedAt = ?
       WHERE id IN (SELECT id FROM subtree) AND userId = ?`,
    ).run(id, userId, userId, isoNow(), userId);

    if (top.parentDocument) {
      const parent = db
        .prepare(`SELECT isArchived FROM documents WHERE id = ?`)
        .get(top.parentDocument) as { isArchived: number } | undefined;
      if (parent?.isArchived) {
        db.prepare(`UPDATE documents SET parentDocument = NULL, updatedAt = ? WHERE id = ?`).run(
          isoNow(),
          id,
        );
      }
    }
  });
  tx();
}

/** 永久删除文档（子文档经 FK ON DELETE SET NULL 摘除父引用） */
export function deleteDocument(db: Database.Database, id: string): void {
  db.prepare(`DELETE FROM documents WHERE id = ?`).run(id);
}

/** 移除图标 / 封面（置 NULL 并刷新 updatedAt） */
export function clearDocumentIcon(db: Database.Database, id: string): void {
  db.prepare(`UPDATE documents SET icon = NULL, updatedAt = ? WHERE id = ?`).run(isoNow(), id);
}

export function clearDocumentCoverImage(db: Database.Database, id: string): void {
  db.prepare(`UPDATE documents SET coverImage = NULL, updatedAt = ? WHERE id = ?`).run(isoNow(), id);
}
