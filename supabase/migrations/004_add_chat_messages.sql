-- 004_add_chat_messages.sql
-- 文章对话历史:每个 documentId 一条独立对话线(user/assistant 交替)
-- 启发自 PandaWiki:对话作为一等公民持久化,支持多轮上下文注入与 token 统计

CREATE TABLE chat_messages (
  "id"                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId"            UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  "documentId"        UUID REFERENCES documents(id) ON DELETE CASCADE,
  "role"              TEXT NOT NULL CHECK ("role" IN ('user', 'assistant')),
  "content"           TEXT NOT NULL,
  "promptTokens"      INTEGER NOT NULL DEFAULT 0,
  "completionTokens"  INTEGER NOT NULL DEFAULT 0,
  "totalTokens"       INTEGER NOT NULL DEFAULT 0,
  "createdAt"         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 加速按文档拉历史(ai-panel 打开/切换文档时)
CREATE INDEX idx_chat_messages_doc
  ON chat_messages ("userId", "documentId", "createdAt" DESC);

ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY chat_messages_select_own ON chat_messages FOR SELECT
  USING (auth.uid() = "userId");

CREATE POLICY chat_messages_insert_own ON chat_messages FOR INSERT
  WITH CHECK (auth.uid() = "userId");
