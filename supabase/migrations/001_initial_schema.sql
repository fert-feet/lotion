-- 001_initial_schema.sql
-- Replaces Convex schema.ts: documents table + indexes
-- Adds ai_sessions and ai_entries for AI agent memory
-- Column names use camelCase to match existing Convex property names

-- Documents table
CREATE TABLE documents (
  "id"                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "title"             TEXT NOT NULL,
  "userId"            UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  "isArchived"        BOOLEAN NOT NULL DEFAULT false,
  "parentDocument"    UUID REFERENCES documents(id) ON DELETE SET NULL,
  "content"           TEXT,
  "coverImage"        TEXT,
  "icon"              TEXT,
  "isPublished"       BOOLEAN NOT NULL DEFAULT false,
  "createdAt"         TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_documents_by_user ON documents ("userId");
CREATE INDEX idx_documents_by_user_parent ON documents ("userId", "parentDocument");

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW."updatedAt" = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_documents_updated_at
  BEFORE UPDATE ON documents
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Enable RLS
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY documents_select_own ON documents FOR SELECT
  USING (auth.uid() = "userId");

CREATE POLICY documents_insert_own ON documents FOR INSERT
  WITH CHECK (auth.uid() = "userId");

CREATE POLICY documents_update_own ON documents FOR UPDATE
  USING (auth.uid() = "userId")
  WITH CHECK (auth.uid() = "userId");

CREATE POLICY documents_delete_own ON documents FOR DELETE
  USING (auth.uid() = "userId");

-- ========================================
-- AI Agent memory tables
-- ========================================

CREATE TABLE ai_sessions (
  "id"         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId"     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  "title"      TEXT NOT NULL DEFAULT '新对话',
  "createdAt"  TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ai_sessions_by_user ON ai_sessions ("userId");

CREATE TRIGGER trg_ai_sessions_updated_at
  BEFORE UPDATE ON ai_sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE ai_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY ai_sessions_select_own ON ai_sessions FOR SELECT
  USING (auth.uid() = "userId");

CREATE POLICY ai_sessions_insert_own ON ai_sessions FOR INSERT
  WITH CHECK (auth.uid() = "userId");

-- ai_entries: append-only event log
CREATE TABLE ai_entries (
  "id"         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "sessionId"  UUID NOT NULL REFERENCES ai_sessions(id) ON DELETE CASCADE,
  "seq"        INTEGER NOT NULL,
  "type"       TEXT NOT NULL CHECK ("type" IN (
                 'user_message', 'assistant_message',
                 'page_ref', 'compaction',
                 'tool_call', 'tool_result'
               )),
  "payload"    JSONB NOT NULL DEFAULT '{}',
  "createdAt"  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE ("sessionId", "seq")
);

CREATE INDEX idx_ai_entries_by_session ON ai_entries ("sessionId", "seq");

ALTER TABLE ai_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY ai_entries_select_own ON ai_entries FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM ai_sessions WHERE id = ai_entries."sessionId" AND "userId" = auth.uid()
  ));

CREATE POLICY ai_entries_insert_own ON ai_entries FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM ai_sessions WHERE id = ai_entries."sessionId" AND "userId" = auth.uid()
  ));
