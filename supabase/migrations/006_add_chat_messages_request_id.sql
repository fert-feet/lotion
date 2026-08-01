-- 006_add_chat_messages_request_id.sql
-- 请求幂等从进程内 Map 迁移到数据库唯一约束：
-- Serverless / 多实例部署下进程内 Map 不共享，重复请求会漏过；
-- 数据库唯一索引天然跨实例生效（23505 冲突即视为重复请求）。

ALTER TABLE chat_messages ADD COLUMN "requestId" TEXT;

-- 同一用户同一 requestId 只允许一条（assistant 消息不携带，NULL 不参与约束）
CREATE UNIQUE INDEX idx_chat_messages_request_id
  ON chat_messages ("userId", "requestId")
  WHERE "requestId" IS NOT NULL;
