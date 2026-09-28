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
  /** assistant 消息的结构化快照 JSON（工具卡/副作用卡/引用/待办/提问/警告/耗时） */
  metadata?: string | null;
  promptTokens?: number;
  completionTokens?: number;
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
  /** 结构化快照（JSON 字符串）；仅 assistant 消息携带 */
  metadata?: string | null;
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
       WHERE userId = ? ORDER BY updatedAt DESC, rowid DESC LIMIT ?`,
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
 * 拉取会话对话历史（返回顺序恒为 createdAt 升序，可直接注入模型）。
 * uncompressedOnly：只取未被压缩标记的消息（压缩检查用，与 lib/db.ts 一致）。
 * limit：取**最新** limit 条（先倒序截断再摆正）——滑动窗口注入的必须是最近的消息，
 * 旧实现 ASC+LIMIT 拿到的是最旧的 N 条（压缩失败时窗口会注入远古对话）。
 */
export function listChatHistory(
  db: Database.Database,
  userId: string,
  sessionId: string,
  limit?: number,
  opts: { uncompressedOnly?: boolean } = {},
): ChatMessage[] {
  const where: string[] = [`userId = ?`, `sessionId = ?`];
  const params: (string | number)[] = [userId, sessionId];
  if (opts.uncompressedOnly) where.push(`compressed = 0`);
  const columns = `id, role, content, createdAt, metadata, promptTokens, completionTokens`;
  const base = `SELECT ${columns} FROM chat_messages WHERE ${where.join(" AND ")}`;

  if (limit === undefined) {
    return db.prepare(`${base} ORDER BY createdAt ASC, rowid ASC`).all(...params) as ChatMessage[];
  }
  // 子查询里倒序取最新 N 条，外层再按时间正序返回
  // （子查询不暴露 rowid，需显式带出来做次级排序键，保证同毫秒消息的稳定顺序）
  const inner = `SELECT ${columns}, rowid AS _rowid FROM chat_messages WHERE ${where.join(" AND ")}`;
  const sql = `SELECT ${columns} FROM (${inner} ORDER BY createdAt DESC, _rowid DESC LIMIT ?) ORDER BY createdAt ASC, _rowid ASC`;
  return db.prepare(sql).all(...params, limit) as ChatMessage[];
}

// ---- AI 改动快照（撤销）----

export interface AiChangeRow {
  id: string;
  documentId: string;
  beforeState: string;
}

/** 记录一次"改动前"文档状态（requestId = 该轮 AI 请求的幂等键） */
export function insertAiChange(
  db: Database.Database,
  input: { userId: string; requestId: string; documentId: string; beforeState: string },
): void {
  db.prepare(
    `INSERT INTO ai_changes (id, userId, requestId, documentId, beforeState, createdAt)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(newId(), input.userId, input.requestId, input.documentId, input.beforeState, isoNow());
}

/** 某轮请求尚未撤销的改动快照（按插入顺序） */
export function listAiChanges(
  db: Database.Database,
  userId: string,
  requestId: string,
): AiChangeRow[] {
  return db
    .prepare(
      `SELECT id, documentId, beforeState FROM ai_changes
       WHERE userId = ? AND requestId = ? AND undoneAt IS NULL
       ORDER BY rowid ASC`,
    )
    .all(userId, requestId) as AiChangeRow[];
}

/** 快照里可恢复的字段（宽容解析：坏/旧格式返回 null） */
export function parseUndoState(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * 撤销某轮 AI 的全部隐式改动（把 beforeState 恢复回文档）。
 * 幂等：已撤销的不再恢复；文档已被删除/快照损坏的条目标记跳过（restored 里不含，skipped +1）。
 * 父文档已不存在时把 parentDocument 归零，避免恢复出悬空父引用。
 */
export function undoAiChanges(
  db: Database.Database,
  userId: string,
  requestId: string,
): { restored: string[]; skipped: number } {
  const rows = listAiChanges(db, userId, requestId);
  const restored: string[] = [];
  const undoneIds: string[] = [];
  let skipped = 0;

  for (const row of rows) {
    const doc = getDocumentById(db, row.documentId, userId);
    const state = parseUndoState(row.beforeState);
    if (!doc || !state) {
      undoneIds.push(row.id);
      skipped++;
      continue;
    }

    let parentDocument: string | null =
      typeof state.parentDocument === "string" ? state.parentDocument : null;
    if (parentDocument !== null && !getDocumentById(db, parentDocument, userId)) {
      parentDocument = null;
    }

    const fields: Record<string, unknown> = {};
    if (typeof state.title === "string") fields.title = state.title;
    if (typeof state.content === "string" || state.content === null) fields.content = state.content;
    if (typeof state.icon === "string" || state.icon === null) fields.icon = state.icon;
    if (typeof state.coverImage === "string" || state.coverImage === null) fields.coverImage = state.coverImage;
    if (typeof state.parentDocument === "string" || state.parentDocument === null) {
      fields.parentDocument = parentDocument;
    }
    if (typeof state.isPublished === "boolean") fields.isPublished = state.isPublished;
    if (typeof state.isArchived === "boolean") fields.isArchived = state.isArchived;

    updateDocument(db, row.documentId, fields as never);
    restored.push(row.documentId);
    undoneIds.push(row.id);
  }

  markAiChangesUndone(db, undoneIds);
  return { restored, skipped };
}

/** 标记这些改动已撤销（幂等：已标记的不重复写入） */
export function markAiChangesUndone(db: Database.Database, ids: string[]): void {
  if (ids.length === 0) return;
  const stmt = db.prepare(`UPDATE ai_changes SET undoneAt = ? WHERE id = ? AND undoneAt IS NULL`);
  const now = isoNow();
  for (const id of ids) stmt.run(now, id);
}

/** 读取会话（含标题与摘要，AI 路由归属校验用） */
export function getChatSession(
  db: Database.Database,
  userId: string,
  sessionId: string,
): { id: string; title: string; summary: string | null } | null {
  const row = db
    .prepare(`SELECT id, title, summary FROM chat_sessions WHERE id = ? AND userId = ?`)
    .get(sessionId, userId) as { id: string; title: string; summary: string | null } | undefined;
  return row ?? null;
}

/** 更新会话标题（并刷新 updatedAt；首个问题自动命名用） */
export function setChatSessionTitle(db: Database.Database, userId: string, sessionId: string, title: string): void {
  db.prepare(`UPDATE chat_sessions SET title = ?, updatedAt = ? WHERE id = ? AND userId = ?`).run(
    title,
    isoNow(),
    sessionId,
    userId,
  );
}

/** 刷新会话 updatedAt（新消息到达时） */
export function touchChatSession(db: Database.Database, userId: string, sessionId: string): void {
  db.prepare(`UPDATE chat_sessions SET updatedAt = ? WHERE id = ? AND userId = ?`).run(
    isoNow(),
    sessionId,
    userId,
  );
}

/** 读取会话压缩摘要 */
export function getChatSessionSummary(db: Database.Database,
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
       (id, userId, sessionId, role, content, promptTokens, completionTokens, totalTokens, requestId, metadata, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    input.metadata ?? null,
    isoNow(),
  );
}

// ---- 文档 ----

/** Document → SidebarDocument（裁剪 content/coverImage，避免解构丢弃变量告警） */
function toSidebar(d: Document): SidebarDocument {
  return {
    id: d.id,
    title: d.title,
    userId: d.userId,
    isArchived: d.isArchived,
    isDraft: d.isDraft,
    parentDocument: d.parentDocument,
    icon: d.icon,
    isPublished: d.isPublished,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}

/** 侧边栏全量文档（未归档，createdAt 倒序，不含 content/coverImage） */
export function listSidebarAll(db: Database.Database, userId: string): SidebarDocument[] {
  const rows = db
    .prepare(
      `SELECT ${SIDEBAR_COLUMNS} FROM documents
       WHERE userId = ? AND isArchived = 0 ORDER BY createdAt DESC, rowid DESC`,
    )
    .all(userId) as DocumentRow[];
  return rows.map(rowToDocument).map(toSidebar);
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
           WHERE userId = ? AND isArchived = 0 AND parentDocument = ? ORDER BY createdAt DESC, rowid DESC`,
        )
        .all(userId, parentDocument) as DocumentRow[]
    ).map(rowToDocument);
  }
  return (
    db
      .prepare(
        `SELECT ${DOCUMENT_COLUMNS} FROM documents
         WHERE userId = ? AND isArchived = 0 AND parentDocument IS NULL ORDER BY createdAt DESC, rowid DESC`,
      )
      .all(userId) as DocumentRow[]
  ).map(rowToDocument);
}

/** 回收站（已归档文档） */
export function listTrash(db: Database.Database, userId: string): SidebarDocument[] {
  const rows = db
    .prepare(
      `SELECT ${SIDEBAR_COLUMNS} FROM documents
       WHERE userId = ? AND isArchived = 1 ORDER BY createdAt DESC, rowid DESC`,
    )
    .all(userId) as DocumentRow[];
  return rows.map(rowToDocument).map(toSidebar);
}

/** 全局搜索候选（与 lib/db.ts 一致：取未归档全量，关键字过滤在客户端 search-command 完成） */
export function listSearch(db: Database.Database, userId: string): SidebarDocument[] {
  return listSidebarAll(db, userId);
}

/**
 * AI 全文搜索（searchNotes 工具用）：标题 + 正文 LIKE 过滤（ASCII 大小写不敏感，通配符已转义）。
 * query 为空时列出全部未归档笔记（按最近更新倒序），支撑"查看我的所有笔记"类请求。
 */
export function searchDocuments(
  db: Database.Database,
  userId: string,
  query: string,
  limit = 20,
): { id: string; title: string; content: string | null; updatedAt: string }[] {
  if (!query.trim()) {
    return db
      .prepare(
        `SELECT id, title, content, updatedAt FROM documents
         WHERE userId = ? AND isArchived = 0
         ORDER BY updatedAt DESC, rowid DESC LIMIT ?`,
      )
      .all(userId, limit) as { id: string; title: string; content: string | null; updatedAt: string }[];
  }
  const escaped = query.replace(/[\\%_]/g, (m) => `\\${m}`);
  return db
    .prepare(
      `SELECT id, title, content, updatedAt FROM documents
       WHERE userId = ? AND isArchived = 0 AND (title LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\')
       ORDER BY updatedAt DESC, rowid DESC LIMIT ?`,
    )
    .all(userId, `%${escaped}%`, `%${escaped}%`, limit) as {
    id: string;
    title: string;
    content: string | null;
    updatedAt: string;
  }[];
}

/** 笔记目录浏览（listNotes 工具用）：未归档文档 + 直接子文档数，按最近更新倒序 */
export function listDocumentsOverview(
  db: Database.Database,
  userId: string,
  parentDocumentId: string | null = null,
  limit = 100,
): { id: string; title: string; updatedAt: string; childCount: number }[] {
  const rows = db
    .prepare(
      `SELECT d.id, d.title, d.updatedAt,
              (SELECT COUNT(*) FROM documents c
               WHERE c.parentDocument = d.id AND c.userId = ? AND c.isArchived = 0) AS childCount
       FROM documents d
       WHERE d.userId = ? AND d.isArchived = 0 AND d.parentDocument IS ?
       ORDER BY d.updatedAt DESC, d.rowid DESC LIMIT ?`,
    )
    .all(userId, userId, parentDocumentId, limit) as {
    id: string;
    title: string;
    updatedAt: string;
    childCount: number;
  }[];
  return rows;
}

/** 指定文档的整棵子孙 id 集合（moveNote 循环检测用，含自身所在层级校验） */
export function getDescendantIds(db: Database.Database, userId: string, id: string): string[] {
  return (
    db
      .prepare(
        `WITH RECURSIVE subtree(id) AS (
           SELECT id FROM documents WHERE id = ? AND userId = ?
           UNION ALL
           SELECT d.id FROM documents d JOIN subtree s ON d.parentDocument = s.id WHERE d.userId = ?
         )
         SELECT id FROM subtree`,
      )
      .all(id, userId, userId) as { id: string }[]
  ).map((r) => r.id);
}

/** 未归档直接子文档数（getDocInfo 工具用） */
export function countChildDocuments(db: Database.Database, userId: string, id: string): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM documents WHERE parentDocument = ? AND userId = ? AND isArchived = 0`,
    )
    .get(id, userId) as { n: number };
  return row.n;
}

/**
 * 移动文档（设置 parentDocument；null = 移到根目录）。
 * 目标父文档必须存在、属于当前用户且未归档；不能移动到自身或自己的子孙下。
 * 返回 false 表示文档不存在或目标不合法（调用方可用 getDescendantIds 等区分原因）。
 */
export function moveDocument(
  db: Database.Database,
  userId: string,
  id: string,
  newParentId: string | null,
): boolean {
  if (newParentId === null) {
    const res = db
      .prepare(`UPDATE documents SET parentDocument = NULL, updatedAt = ? WHERE id = ? AND userId = ?`)
      .run(isoNow(), id, userId);
    return res.changes > 0;
  }
  if (newParentId === id) return false;
  const parent = db
    .prepare(`SELECT id FROM documents WHERE id = ? AND userId = ? AND isArchived = 0`)
    .get(newParentId, userId);
  if (!parent) return false;
  // 防循环：目标父文档不能位于被移动文档的子树中
  const inSubtree = db
    .prepare(
      `WITH RECURSIVE subtree(id) AS (
         SELECT id FROM documents WHERE id = ? AND userId = ?
         UNION ALL
         SELECT d.id FROM documents d JOIN subtree s ON d.parentDocument = s.id WHERE d.userId = ?
       )
       SELECT id FROM subtree WHERE id = ? LIMIT 1`,
    )
    .get(id, userId, userId, newParentId);
  if (inSubtree) return false;
  const res = db
    .prepare(`UPDATE documents SET parentDocument = ?, updatedAt = ? WHERE id = ? AND userId = ?`)
    .run(newParentId, isoNow(), id, userId);
  return res.changes > 0;
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
export function updateDocument(  db: Database.Database,
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

/** 单笔记归档/恢复（AI archiveNote 工具用：与 PG 版一致，只影响单条，不递归子树） */
export function setDocumentArchived(db: Database.Database, userId: string, id: string, archived: boolean): boolean {
  const res = db
    .prepare(`UPDATE documents SET isArchived = ?, updatedAt = ? WHERE id = ? AND userId = ?`)
    .run(archived ? 1 : 0, isoNow(), id, userId);
  return res.changes > 0;
}

/** 移除图标 / 封面（置 NULL 并刷新 updatedAt） */
export function clearDocumentIcon(db: Database.Database, id: string): void {
  db.prepare(`UPDATE documents SET icon = NULL, updatedAt = ? WHERE id = ?`).run(isoNow(), id);
}

export function clearDocumentCoverImage(db: Database.Database, id: string): void {
  db.prepare(`UPDATE documents SET coverImage = NULL, updatedAt = ? WHERE id = ?`).run(isoNow(), id);
}
