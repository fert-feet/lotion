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
  /** 绑定的文档 id（NULL = 全局会话） */
  documentId?: string | null;
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
type DocumentRow = Omit<Document, "isArchived" | "isDraft"> & {
  isArchived: number;
  isDraft: number;
};

function rowToDocument(r: DocumentRow): Document {
  return { ...r, isArchived: !!r.isArchived, isDraft: !!r.isDraft };
}

// 查询语句写成完整字面量常量（不在 prepare 里拼列名）：
// 列清单是编译期常量，但拼接会让静态检查与人工审查都无法确认"SQL 里没有外部输入"。
const Q_DOCUMENT = `id, title, userId, isArchived, isDraft, parentDocument, content, coverImage, icon, createdAt, updatedAt`;
const Q_SIDEBAR = `id, title, userId, isArchived, isDraft, parentDocument, icon, createdAt, updatedAt`;

const SQL_SIDEBAR_ALL = `SELECT ${Q_SIDEBAR} FROM documents WHERE userId = ? AND isArchived = 0 ORDER BY createdAt DESC, rowid DESC`;
const SQL_TRASH_ALL = `SELECT ${Q_SIDEBAR} FROM documents WHERE userId = ? AND isArchived = 1 ORDER BY createdAt DESC, rowid DESC`;
const SQL_CHILDREN_BY_PARENT = `SELECT ${Q_DOCUMENT} FROM documents WHERE userId = ? AND isArchived = 0 AND parentDocument = ? ORDER BY createdAt DESC, rowid DESC`;
const SQL_ROOT_CHILDREN = `SELECT ${Q_DOCUMENT} FROM documents WHERE userId = ? AND isArchived = 0 AND parentDocument IS NULL ORDER BY createdAt DESC, rowid DESC`;
const SQL_DOCUMENT_BY_ID = `SELECT ${Q_DOCUMENT} FROM documents WHERE id = ?`;
const SQL_DOCUMENT_BY_ID_USER = `SELECT ${Q_DOCUMENT} FROM documents WHERE id = ? AND userId = ?`;
const SQL_UPDATE_DOCUMENT = `UPDATE documents SET title = ?, content = ?, coverImage = ?, icon = ?, isDraft = ?, updatedAt = ? WHERE id = ? AND userId = ?`;

// ---- AI 会话 ----

/** 列出当前用户全部会话（按最近更新倒序，最多 50 条，与 lib/db.ts 一致） */
export function listChatSessions(db: Database.Database, userId: string, limit = 50): ChatSession[] {
  return db
    .prepare(
      `SELECT id, title, createdAt, updatedAt, documentId FROM chat_sessions
       WHERE userId = ? ORDER BY updatedAt DESC, rowid DESC LIMIT ?`,
    )
    .all(userId, limit) as ChatSession[];
}

/**
 * 新建会话，返回新会话 id。
 * documentId：把会话绑定到某篇文档（"这篇文档的对话"）；归属由调用方（路由）校验。
 */
export function createChatSession(
  db: Database.Database,
  userId: string,
  title = "新对话",
  documentId: string | null = null,
): string {
  const id = newId();
  const now = isoNow();
  db.prepare(
    `INSERT INTO chat_sessions (id, userId, title, documentId, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, userId, title, documentId, now, now);
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
    if (typeof state.isArchived === "boolean") fields.isArchived = state.isArchived;

    updateDocument(db, userId, row.documentId, fields as never);
    restored.push(row.documentId);
    undoneIds.push(row.id);
  }

  markAiChangesUndone(db, undoneIds);
  return { restored, skipped };
}

/**
 * 某一轮 AI 改动的"改动前后"对照（Markdown）。
 * 宿主侧实现：REST 侧的同一功能在 server/routes/ai-undo.ts（两侧都做 Markdown 转换）。
 */
export async function previewAiChanges(
  db: Database.Database,
  userId: string,
  requestId: string,
): Promise<Array<{ documentId: string; title: string; beforeTitle: string; before: string; after: string }>> {
  const { toMarkdown } = await import("./../content-server");
  const rows = listAiChanges(db, userId, requestId);
  const out: Array<{ documentId: string; title: string; beforeTitle: string; before: string; after: string }> = [];
  for (const row of rows) {
    const doc = getDocumentById(db, row.documentId, userId);
    const state = parseUndoState(row.beforeState);
    if (!doc || !state) continue;
    const beforeContent = typeof state.content === "string" ? state.content : "";
    out.push({
      documentId: row.documentId,
      title: doc.title,
      beforeTitle: typeof state.title === "string" ? state.title : doc.title,
      before: (await toMarkdown(beforeContent)).slice(0, 4000),
      after: (await toMarkdown(doc.content)).slice(0, 4000),
    });
  }
  return out;
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
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}

/** 侧边栏全量文档（未归档，createdAt 倒序，不含 content/coverImage） */
export function listSidebarAll(db: Database.Database, userId: string): SidebarDocument[] {
  const rows = db
    .prepare(
      SQL_SIDEBAR_ALL,
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
          SQL_CHILDREN_BY_PARENT,
        )
        .all(userId, parentDocument) as DocumentRow[]
    ).map(rowToDocument);
  }
  return (
    db
      .prepare(
        SQL_ROOT_CHILDREN,
      )
      .all(userId) as DocumentRow[]
  ).map(rowToDocument);
}

/** 回收站（已归档文档） */
export function listTrash(db: Database.Database, userId: string): SidebarDocument[] {
  const rows = db
    .prepare(
      SQL_TRASH_ALL,
    )
    .all(userId) as DocumentRow[];
  return rows.map(rowToDocument).map(toSidebar);
}

/** 全局搜索候选（与 lib/db.ts 一致：取未归档全量，关键字过滤在客户端 search-command 完成） */
export function listSearch(db: Database.Database, userId: string): SidebarDocument[] {
  return listSidebarAll(db, userId);
}

/** FTS5 trigram 至少需要 3 个字符才能切出三元组；更短的查询回落 LIKE。 */
const FTS_MIN_QUERY_LENGTH = 3;

/**
 * AI 全文搜索（searchNotes 工具用）。
 *
 * 三级策略：
 * 1. 空查询 → 列出全部未归档笔记（支撑"看看我的所有笔记"）；
 * 2. ≥3 字符 → FTS5 trigram 索引（中文可用，O(索引) 而非全表扫）；
 * 3. 更短 / FTS 无命中 / 旧库无 FTS 表 → LIKE 兜底（转义 \ % _）。
 */
export function searchDocuments(
  db: Database.Database,
  userId: string,
  query: string,
  limit = 20,
): { id: string; title: string; content: string | null; updatedAt: string }[] {
  const q = query.trim();
  type Row = { id: string; title: string; content: string | null; updatedAt: string };

  if (!q) {
    return db
      .prepare(
        `SELECT id, title, content, updatedAt FROM documents
         WHERE userId = ? AND isArchived = 0
         ORDER BY updatedAt DESC, rowid DESC LIMIT ?`,
      )
      .all(userId, limit) as Row[];
  }

  if ([...q].length >= FTS_MIN_QUERY_LENGTH) {
    // 短语查询：FTS5 语法里双引号 = 短语，内部双引号需成对转义
    const match = `"${q.replace(/"/g, '""')}"`;
    try {
      const rows = db
        .prepare(
          `SELECT d.id, d.title, d.content, d.updatedAt
           FROM documents_fts JOIN documents d ON d.rowid = documents_fts.rowid
           WHERE documents_fts MATCH ? AND d.userId = ? AND d.isArchived = 0
           ORDER BY d.updatedAt DESC, d.rowid DESC LIMIT ?`,
        )
        .all(match, userId, limit) as Row[];
      if (rows.length > 0) return rows;
    } catch {
      // FTS 表不存在（未迁移的旧库）或查询语法异常 → 走 LIKE，绝不因索引问题让搜索失败
    }
  }

  const escaped = q.replace(/[\\%_]/g, (m) => `\\${m}`);
  return db
    .prepare(
      `SELECT id, title, content, updatedAt FROM documents
       WHERE userId = ? AND isArchived = 0 AND (title LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\')
       ORDER BY updatedAt DESC, rowid DESC LIMIT ?`,
    )
    .all(userId, `%${escaped}%`, `%${escaped}%`, limit) as Row[];
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
 * 不传只给内部的展示型读取（如版本历史回滚预览）用，写路径必须带 userId。
 */
export function getDocumentById(
  db: Database.Database,
  documentId: string,
  userId?: string,
): Document | null {
  const row = userId
    ? (db
        .prepare(SQL_DOCUMENT_BY_ID_USER)
        .get(documentId, userId) as DocumentRow | undefined)
    : (db.prepare(SQL_DOCUMENT_BY_ID).get(documentId) as DocumentRow | undefined);
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
    `INSERT INTO documents (id, title, userId, isArchived, isDraft, parentDocument, createdAt, updatedAt)
     VALUES (?, ?, ?, 0, 0, ?, ?, ?)`,
  ).run(id, title, userId, parentDocument || null, now, now);
  return id;
}

/**
 * 更新文档字段（显式刷 updatedAt；本地版无 PG 触发器）。
 *
 * ⚠️ `userId` 是**归属过滤**，不是可选项：WHERE 永远带 `AND userId = ?`（与 setDocumentArchived 同型）。
 * 无 RLS 兜底，写路径一旦漏掉归属条件就是横向越权（任何登录用户可改他人文档）。
 * @returns 是否命中一行（false = 文档不存在或不属于该 userId，调用方据此回 404）
 */
export function updateDocument(
  db: Database.Database,
  userId: string,
  id: string,
  fields: Partial<
    Pick<Document, "title" | "content" | "coverImage" | "icon" | "isDraft">
  >,
  options: { source?: DocumentVersionSource } = {},
): boolean {
  // 没有任何可更新字段时返回 false（不误报成功，也不写版本快照）
  if (Object.keys(fields).length === 0) return false;

  const current = db.prepare(SQL_DOCUMENT_BY_ID_USER).get(id, userId) as DocumentRow | undefined;
  if (!current) return false;

  // 版本历史：标题/正文**确实发生变化**前，把改动前的状态快照存一份（节流 + 去重）
  const titleChanged = fields.title !== undefined && fields.title !== current.title;
  const contentChanged =
    fields.content !== undefined && (fields.content ?? null) !== (current.content ?? null);
  if (titleChanged || contentChanged) {
    recordDocumentVersion(db, userId, id, options.source ?? "user");
  }

  // 固定 UPDATE：先合并再整行写回。动态 SET 拼串（即使列名来自白名单）会让
  // "SQL 里没有外部输入" 这件事无法静态确认，收益不值这个风险。
  const merged = {
    title: fields.title ?? current.title,
    content: fields.content === undefined ? current.content : fields.content,
    coverImage: fields.coverImage === undefined ? current.coverImage : fields.coverImage,
    icon: fields.icon === undefined ? current.icon : fields.icon,
    isDraft: fields.isDraft === undefined ? current.isDraft === 1 : fields.isDraft,
  };
  const res = db
    .prepare(SQL_UPDATE_DOCUMENT)
    .run(
      merged.title,
      merged.content,
      merged.coverImage,
      merged.icon,
      merged.isDraft ? 1 : 0,
      isoNow(),
      id,
      userId,
    );
  return res.changes > 0;
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

/**
 * 永久删除文档（子文档经 FK ON DELETE SET NULL 摘除父引用）。
 *
 * ⚠️ `userId` 是**归属过滤**，不是可选项（同 updateDocument）。
 * @returns 是否命中一行（false = 文档不存在或不属于该 userId，调用方据此回 404）
 */
export function deleteDocument(db: Database.Database, userId: string, id: string): boolean {
  const res = db
    .prepare(`DELETE FROM documents WHERE id = ? AND userId = ?`)
    .run(id, userId);
  return res.changes > 0;
}

/** 单笔记归档/恢复（AI archiveNote 工具用：与 PG 版一致，只影响单条，不递归子树） */
export function setDocumentArchived(db: Database.Database, userId: string, id: string, archived: boolean): boolean {
  const res = db
    .prepare(`UPDATE documents SET isArchived = ?, updatedAt = ? WHERE id = ? AND userId = ?`)
    .run(archived ? 1 : 0, isoNow(), id, userId);
  return res.changes > 0;
}

/** 移除图标 / 封面（置 NULL 并刷新 updatedAt）。⚠️ `userId` 归属过滤，同 updateDocument */
export function clearDocumentIcon(db: Database.Database, userId: string, id: string): boolean {
  const res = db
    .prepare(`UPDATE documents SET icon = NULL, updatedAt = ? WHERE id = ? AND userId = ?`)
    .run(isoNow(), id, userId);
  return res.changes > 0;
}

export function clearDocumentCoverImage(
  db: Database.Database,
  userId: string,
  id: string,
): boolean {
  const res = db
    .prepare(`UPDATE documents SET coverImage = NULL, updatedAt = ? WHERE id = ? AND userId = ?`)
    .run(isoNow(), id, userId);
  return res.changes > 0;
}

// ---------------------------------------------------------------------------
// 文档版本历史
//
// 每次标题/正文发生变化前，把**改动前**的快照存一份，供时间线预览与一键回滚。
// 写入是节流的：同类改动 60s 内只留一份，内容完全相同时直接跳过；每篇文档保留
// 最近 VERSION_KEEP 份（备份语义是"回到最近的一次"，不是审计日志）。
// ---------------------------------------------------------------------------

/** 版本来源：用户编辑 / AI 写入 */
export type DocumentVersionSource = "user" | "ai";

/** 单个文档保留的历史份数 */
export const VERSION_KEEP = 50;
/** 版本写入节流（同一文档 60s 内最多留一份，避免自动保存把时间线刷爆） */
export const VERSION_MIN_INTERVAL_MS = 60_000;

/** 版本摘要（列表用，不含正文） */
export interface DocumentVersionSummary {
  id: string;
  title: string;
  source: DocumentVersionSource;
  createdAt: string;
  contentLength: number;
}

/** 完整版本（含正文） */
export interface DocumentVersion extends DocumentVersionSummary {
  content: string | null;
}

function rowToVersionSummary(row: {
  id: string;
  title: string;
  source: string;
  createdAt: string;
  content: string | null;
}): DocumentVersionSummary {
  return {
    id: row.id,
    title: row.title,
    source: row.source === "ai" ? "ai" : "user",
    createdAt: row.createdAt,
    contentLength: row.content?.length ?? 0,
  };
}

/**
 * 记录一次改动前快照（节流 + 去重 + 保留份数），返回是否真的写入。
 * 由 updateDocument 自动调用，一般不需要显式使用。
 */
export function recordDocumentVersion(
  db: Database.Database,
  userId: string,
  documentId: string,
  source: DocumentVersionSource,
  options: { now?: string; force?: boolean } = {},
): boolean {
  const now = options.now ?? isoNow();
  const current = db
    .prepare('SELECT title, content FROM documents WHERE id = ? AND userId = ?')
    .get(documentId, userId) as { title: string; content: string | null } | undefined;
  if (!current) return false;

  const last = db
    .prepare(
      `SELECT id, title, content, createdAt FROM document_versions
       WHERE documentId = ? AND userId = ? ORDER BY createdAt DESC, rowid DESC LIMIT 1`,
    )
    .get(documentId, userId) as
    | { id: string; title: string; content: string | null; createdAt: string }
    | undefined;

  // 内容没变 → 不记（自动保存/重复 PATCH 不产生噪声）
  if (last && last.title === current.title && (last.content ?? "") === (current.content ?? "")) {
    return false;
  }
  // 节流：距上一份不足 60s 且不是第一次 → 跳过（最坏情况下一次编辑会话只留首尾）
  // force（显式回滚）不受节流限制：用户点"恢复"必须真的留档，否则回滚不可逆。
  if (last && !options.force) {
    const elapsed = Date.parse(now) - Date.parse(last.createdAt);
    if (Number.isFinite(elapsed) && elapsed < VERSION_MIN_INTERVAL_MS) return false;
  }

  db.prepare(
    `INSERT INTO document_versions (id, documentId, userId, title, content, source, createdAt)
     VALUES (?,?,?,?,?,?,?)`,
  ).run(newId(), documentId, userId, current.title, current.content, source, now);

  // 只保留最近 VERSION_KEEP 份
  db.prepare(
    `DELETE FROM document_versions
     WHERE documentId = ? AND userId = ? AND id NOT IN (
       SELECT id FROM document_versions
       WHERE documentId = ? AND userId = ? ORDER BY createdAt DESC, rowid DESC LIMIT ?
     )`,
  ).run(documentId, userId, documentId, userId, VERSION_KEEP);
  return true;
}

/** 某文档的版本时间线（新→旧，不含正文） */
export function listDocumentVersions(
  db: Database.Database,
  userId: string,
  documentId: string,
  limit = VERSION_KEEP,
): DocumentVersionSummary[] {
  const rows = db
    .prepare(
      `SELECT id, title, source, createdAt, content FROM document_versions
       WHERE documentId = ? AND userId = ? ORDER BY createdAt DESC, rowid DESC LIMIT ?`,
    )
    .all(documentId, userId, limit) as {
    id: string;
    title: string;
    source: string;
    createdAt: string;
    content: string | null;
  }[];
  return rows.map(rowToVersionSummary);
}

/** 取单个版本全文（预览用） */
export function getDocumentVersion(
  db: Database.Database,
  userId: string,
  documentId: string,
  versionId: string,
): DocumentVersion | null {
  const row = db
    .prepare(
      `SELECT id, title, source, createdAt, content FROM document_versions
       WHERE id = ? AND documentId = ? AND userId = ?`,
    )
    .get(versionId, documentId, userId) as
    | { id: string; title: string; source: string; createdAt: string; content: string | null }
    | undefined;
  if (!row) return null;
  return { ...rowToVersionSummary(row), content: row.content };
}

/**
 * 回滚到某个版本。回滚本身也是一次编辑，因此**当前状态会先被记成一份新版本**
 * （回滚错了可以再滚回来）。
 */
export function restoreDocumentVersion(
  db: Database.Database,
  userId: string,
  documentId: string,
  versionId: string,
): boolean {
  const version = getDocumentVersion(db, userId, documentId, versionId);
  if (!version) return false;
  // 回滚必须留档（否则"回滚错了"就再也回不去），因此先强制记一份当前状态，
  // 再走常规更新（常规更新自己也会再尝试记一份，若内容未变则被去重跳过）。
  recordDocumentVersion(db, userId, documentId, "user", { force: true });
  return updateDocument(
    db,
    userId,
    documentId,
    { title: version.title, content: version.content },
    { source: "user" },
  );
}
