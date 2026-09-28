// ⚠️ 服务端专用模块：所有 lib/local/* 只能在 Node 运行时（route handler / 服务端组件）导入，
// 严禁被 "use client" 组件 import（better-sqlite3 是原生模块，无法打包进浏览器）。
// 本地版本 SQLite DDL（单文件全量迁移，替代 supabase/migrations 的 7 个 PG 迁移）。
//
// 与 PostgreSQL 版的差异（决策记录）：
// - gen_random_uuid() → 应用层 crypto.randomUUID()（DDL 无默认值，插入时显式提供）
// - TIMESTAMPTZ → TEXT（ISO 8601 字符串，new Date().toISOString()）
// - BOOLEAN → INTEGER(0/1)，数据层读出行时映射回 boolean（见 lib/local/db.ts）
// - RLS 全部移除：本地版没有 auth.uid()，安全边界在应用层（所有查询强制带 userId）
// - updatedAt 触发器 → 应用层显式更新（SQLite 同表触发器有递归更新陷阱，且应用层更可测）
// - ai_sessions / ai_entries（PG 001 里的早期 AI 记忆表）已废弃未使用，本地版不建

export interface LocalMigration {
  name: string;
  sql: string;
}

export const LOCAL_MIGRATIONS: LocalMigration[] = [
  {
    name: "001_initial_schema",
    sql: `
-- 用户表：本地 Auth 的用户实体（替代 Supabase auth.users）
CREATE TABLE IF NOT EXISTS users (
  "id"            TEXT PRIMARY KEY,                  -- crypto.randomUUID()
  "email"         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  "passwordHash"  TEXT NOT NULL,                     -- scrypt 哈希（含盐，格式见 lib/local/auth.ts）
  "name"          TEXT,
  "createdAt"     TEXT NOT NULL,
  "updatedAt"     TEXT NOT NULL
);

-- 会话表：自研 Auth 的登录会话（token 存库而非 JWT，可服务端吊销）
CREATE TABLE IF NOT EXISTS sessions (
  "id"            TEXT PRIMARY KEY,                  -- 随机 32 字节 hex，同时是 cookie 值
  "userId"        TEXT NOT NULL REFERENCES users("id") ON DELETE CASCADE,
  "createdAt"     TEXT NOT NULL,
  "expiresAt"     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions ("userId");
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions ("expiresAt");

-- 文档表：字段与 PG documents 一致（去 RLS、去 UUID 默认值、BOOLEAN → INTEGER）
CREATE TABLE IF NOT EXISTS documents (
  "id"              TEXT PRIMARY KEY,
  "title"           TEXT NOT NULL,
  "userId"          TEXT NOT NULL REFERENCES users("id") ON DELETE CASCADE,
  "isArchived"      INTEGER NOT NULL DEFAULT 0,
  "isDraft"         INTEGER NOT NULL DEFAULT 0,
  "parentDocument"  TEXT REFERENCES documents("id") ON DELETE SET NULL,
  "content"         TEXT,
  "coverImage"      TEXT,
  "icon"            TEXT,
  "isPublished"     INTEGER NOT NULL DEFAULT 0,
  "createdAt"       TEXT NOT NULL,
  "updatedAt"       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_documents_by_user ON documents ("userId");
CREATE INDEX IF NOT EXISTS idx_documents_by_user_parent ON documents ("userId", "parentDocument");
CREATE INDEX IF NOT EXISTS idx_documents_sidebar ON documents ("userId", "isArchived", "parentDocument", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS idx_documents_id_user ON documents ("id", "userId");

-- 会话表：全局 AI 对话会话（对应 PG chat_sessions）
CREATE TABLE IF NOT EXISTS chat_sessions (
  "id"          TEXT PRIMARY KEY,
  "userId"      TEXT NOT NULL REFERENCES users("id") ON DELETE CASCADE,
  "title"       TEXT NOT NULL DEFAULT '新对话',
  "summary"     TEXT,                                -- 上下文压缩摘要（见 lib/compress.ts）
  "createdAt"   TEXT NOT NULL,
  "updatedAt"   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_by_user ON chat_sessions ("userId", "updatedAt" DESC);

-- 消息表：AI 对话消息（对应 PG chat_messages；documentId 为 005 之前的遗留列，不再写入）
CREATE TABLE IF NOT EXISTS chat_messages (
  "id"                TEXT PRIMARY KEY,
  "userId"            TEXT NOT NULL REFERENCES users("id") ON DELETE CASCADE,
  "sessionId"         TEXT REFERENCES chat_sessions("id") ON DELETE CASCADE,
  "documentId"        TEXT REFERENCES documents("id") ON DELETE CASCADE,
  "role"              TEXT NOT NULL CHECK ("role" IN ('user', 'assistant')),
  "content"           TEXT NOT NULL,
  "promptTokens"      INTEGER NOT NULL DEFAULT 0,
  "completionTokens"  INTEGER NOT NULL DEFAULT 0,
  "totalTokens"       INTEGER NOT NULL DEFAULT 0,
  "requestId"         TEXT,                          -- 幂等键（仅 user 消息携带）
  "compressed"        INTEGER NOT NULL DEFAULT 0,    -- 已被压缩进 summary 的标记
  "createdAt"         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages ("userId", "sessionId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS idx_chat_messages_doc ON chat_messages ("userId", "documentId", "createdAt" DESC);
-- 幂等约束：同用户同 requestId 只允许一条（对应 PG partial unique index，SQLite 同样支持）
CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_messages_request_id
  ON chat_messages ("userId", "requestId")
  WHERE "requestId" IS NOT NULL;
`,
  },
  {
    // 002：assistant 消息的结构化快照（工具卡 / 副作用卡 / 引用 / 待办 / 提问 / 警告 / 耗时）。
    // 没有它时刷新会话只剩一段纯文本：工具卡、待确认的删除/移动、引用全部消失。
    // ALTER TABLE ADD COLUMN 是 SQLite 支持的轻量迁移（新库由 001 建表后再补这一列）。
    name: "002_chat_message_metadata",
    sql: `
ALTER TABLE chat_messages ADD COLUMN "metadata" TEXT;
`,
  },
  {
    // 003：AI 改动的"改动前快照"（撤销用）。每个被 AI 写过的文档一行，
    // 按 (userId, requestId) 分组；撤销 = 把这些字段恢复回去并标记 undoneAt。
    // 只覆盖 AI 的隐式写入（updateNote/updateBlock/renameNote/setNoteIcon/publishNote/
    // archiveNote/restoreNote）；用户**显式确认**过的删除/移动不在此列（确认框已是一次确认）。
    name: "003_ai_changes",
    sql: `
CREATE TABLE IF NOT EXISTS ai_changes (
  "id"           TEXT PRIMARY KEY,
  "userId"       TEXT NOT NULL REFERENCES users("id") ON DELETE CASCADE,
  "requestId"    TEXT NOT NULL,
  "documentId"   TEXT NOT NULL,
  "beforeState"  TEXT NOT NULL,
  "createdAt"    TEXT NOT NULL,
  "undoneAt"     TEXT
);
CREATE INDEX IF NOT EXISTS idx_ai_changes_request ON ai_changes ("userId", "requestId");
`,
  },
];
