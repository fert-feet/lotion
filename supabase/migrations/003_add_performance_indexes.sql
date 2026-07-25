-- 加速侧边栏查询：按用户 + 归档状态 + 父文档 + 时间排序
CREATE INDEX IF NOT EXISTS idx_documents_sidebar
  ON documents (userId, isArchived, parentDocument, createdAt DESC);

-- 加速单文档查询（getById）
CREATE INDEX IF NOT EXISTS idx_documents_id_user
  ON documents (id, userId);
