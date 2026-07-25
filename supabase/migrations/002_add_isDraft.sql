-- 002_add_isDraft.sql
-- Add isDraft column for AI-generated draft documents

ALTER TABLE documents ADD COLUMN "isDraft" BOOLEAN NOT NULL DEFAULT false;
