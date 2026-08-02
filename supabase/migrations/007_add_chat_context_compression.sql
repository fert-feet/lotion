-- 007_add_chat_context_compression.sql
-- 会话上下文压缩（滑动窗口 + 模型决定摘要）：
-- 1. chat_sessions.summary —— 已压缩早期对话的语义摘要（每会话一个，重写式更新）
-- 2. chat_messages.compressed —— 该消息已被压缩进 summary 的标记（原文保留，仅不再注入模型）
-- 注：压缩是后台任务（assistant 落库后 fire-and-forget），失败降级为不压缩，不影响对话主流程。

ALTER TABLE chat_sessions
  ADD COLUMN "summary" TEXT;

ALTER TABLE chat_messages
  ADD COLUMN "compressed" BOOLEAN NOT NULL DEFAULT false;

-- 压缩任务用 anon key 服务端客户端写 compressed 标记：
-- chat_messages 原有策略只有 SELECT/INSERT，必须补 UPDATE 策略，否则 RLS 静默拒绝更新
-- （PostgREST 对无权限 UPDATE 返回 data:[], error:null，不抛错，压缩会"看似成功"实则失效）
CREATE POLICY chat_messages_update_own ON chat_messages FOR UPDATE
  USING (auth.uid() = "userId");

-- 压缩检查按会话扫未压缩消息：现有 idx_chat_messages_session ("userId","sessionId","createdAt" DESC)
-- 已覆盖查询路径（compressed 是低基数列，无需单独索引）
