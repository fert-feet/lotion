-- 005_add_chat_sessions.sql
-- 全局会话:对话不再按文档隔离,而是存在多个彼此独立的 session 中
-- chat_messages 归属从 documentId 迁移到 sessionId(旧 documentId 列保留,不再写入)

-- 会话表(全局,不绑定文档)
CREATE TABLE chat_sessions (
  "id"         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId"     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  "title"      TEXT NOT NULL DEFAULT '新对话',
  "createdAt"  TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_chat_sessions_by_user ON chat_sessions ("userId", "updatedAt" DESC);

ALTER TABLE chat_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY chat_sessions_select_own ON chat_sessions FOR SELECT
  USING (auth.uid() = "userId");

CREATE POLICY chat_sessions_insert_own ON chat_sessions FOR INSERT
  WITH CHECK (auth.uid() = "userId");

CREATE POLICY chat_sessions_update_own ON chat_sessions FOR UPDATE
  USING (auth.uid() = "userId")
  WITH CHECK (auth.uid() = "userId");

CREATE POLICY chat_sessions_delete_own ON chat_sessions FOR DELETE
  USING (auth.uid() = "userId");

-- 消息归属改为 session(级联删除:删 session 即删其全部消息)
ALTER TABLE chat_messages
  ADD COLUMN "sessionId" UUID REFERENCES chat_sessions(id) ON DELETE CASCADE;

CREATE INDEX idx_chat_messages_session
  ON chat_messages ("userId", "sessionId", "createdAt" DESC);
