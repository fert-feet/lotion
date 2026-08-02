import { createClient } from "@/lib/supabase/client";

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

/** 侧边栏用，不含 content 和 coverImage */
export type SidebarDocument = Omit<Document, "content" | "coverImage">;

/** 文章对话历史消息 */
export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
};

/** 全局会话（不绑定文档） */
export type ChatSession = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

/** 落库用的消息（server 端写入） */
export type ChatMessageInput = {
  userId: string;
  sessionId?: string | null;
  role: "user" | "assistant";
  content: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  /** 幂等键（仅 user 消息携带）：靠 chat_messages(userId, requestId) 唯一约束防重复提交 */
  requestId?: string;
};

function supabase() {
  return createClient();
}

// ---- Queries ----

// ---- Chat history ----

/** 列出当前用户全部会话（按最近更新倒序，最多 50 条） */
export async function getChatSessions(userId: string): Promise<ChatSession[]> {
  const { data } = await supabase()
    .from("chat_sessions")
    .select("id, title, createdAt, updatedAt")
    .eq("userId", userId)
    .order("updatedAt", { ascending: false })
    .limit(50);

  return (data || []) as ChatSession[];
}

/** 新建会话，返回 session id */
export async function createChatSession(userId: string, title = "新对话"): Promise<string> {
  const { data, error } = await supabase()
    .from("chat_sessions")
    .insert({ userId, title })
    .select("id")
    .single();

  if (error || !data) throw error;
  return data.id;
}

/** 删除会话（chat_messages 级联删除） */
export async function deleteChatSession(userId: string, sessionId: string) {
  const { error } = await supabase()
    .from("chat_sessions")
    .delete()
    .eq("id", sessionId)
    .eq("userId", userId);

  if (error) throw error;
}

/** 拉取某会话的对话历史（时间升序，用于注入 AI 上下文与前端渲染） */
export async function getChatHistory(
  userId: string,
  sessionId: string | null,
  limit?: number,
  client?: ReturnType<typeof supabase>,
  options?: { uncompressedOnly?: boolean },
): Promise<ChatMessage[]> {
  const db = client ?? supabase();
  let query = db
    .from("chat_messages")
    .select("id, role, content, createdAt")
    .eq("userId", userId)
    .order("createdAt", { ascending: false });

  // limit 不传时为全量拉取（AI 上下文注入不做条数限制）
  if (limit && limit > 0) {
    query = query.limit(limit);
  }

  if (sessionId) {
    query = query.eq("sessionId", sessionId);
  }

  // 上下文压缩后：AI 注入只取未压缩消息（前端渲染仍全量）
  if (options?.uncompressedOnly) {
    query = query.eq("compressed", false);
  }

  const { data } = await query;
  return ((data || []) as ChatMessage[]).reverse(); // 转回时间升序
}

/** 读取会话已压缩部分的摘要（上下文压缩用；无摘要返回 null） */
export async function getChatSessionSummary(
  client: ReturnType<typeof supabase>,
  userId: string,
  sessionId: string,
): Promise<string | null> {
  const { data } = await client
    .from("chat_sessions")
    .select("summary")
    .eq("id", sessionId)
    .eq("userId", userId)
    .single();
  return (data?.summary as string | null) ?? null;
}

/** 重写式更新会话摘要（上下文压缩用） */
export async function updateChatSessionSummary(
  client: ReturnType<typeof supabase>,
  userId: string,
  sessionId: string,
  summary: string,
) {
  const { error } = await client
    .from("chat_sessions")
    .update({ summary })
    .eq("id", sessionId)
    .eq("userId", userId);
  if (error) throw error;
}

/** 批量标记消息已压缩（带 userId 条件防跨用户；id 快照标记，天然防重入） */
export async function markMessagesCompressed(
  client: ReturnType<typeof supabase>,
  userId: string,
  ids: string[],
) {
  const { error } = await client
    .from("chat_messages")
    .update({ compressed: true })
    .eq("userId", userId)
    .in("id", ids);
  if (error) throw error;
}

/** 写入一条对话消息（server 端：route.ts 落库 user/assistant 消息） */
export async function insertChatMessage(
  supabaseClient: ReturnType<typeof supabase>,
  msg: ChatMessageInput,
) {
  const { error } = await supabaseClient.from("chat_messages").insert({
    userId: msg.userId,
    sessionId: msg.sessionId || null,
    role: msg.role,
    content: msg.content,
    promptTokens: msg.promptTokens || 0,
    completionTokens: msg.completionTokens || 0,
    totalTokens: msg.totalTokens || 0,
    requestId: msg.requestId || null,
  });
  if (error) throw error;
}

/** 一次性拉取侧边栏全部文档（不含正文），前端本地按 parentDocument 建树 */
export async function getSidebarAll(userId: string): Promise<SidebarDocument[]> {
  const { data } = await supabase()
    .from("documents")
    .select("id, title, userId, isArchived, isDraft, parentDocument, icon, isPublished, createdAt, updatedAt")
    .eq("userId", userId)
    .eq("isArchived", false)
    .order("createdAt", { ascending: false });

  return (data || []) as SidebarDocument[];
}

/** @deprecated 使用 getSidebarAll 替代 */
export async function getSidebar(userId: string, parentDocument?: string | null) {
  const query = supabase()
    .from("documents")
    .select("*")
    .eq("userId", userId)
    .eq("isArchived", false)
    .order("createdAt", { ascending: false });

  if (parentDocument) {
    query.eq("parentDocument", parentDocument);
  } else {
    query.is("parentDocument", null);
  }

  const { data } = await query;
  return data || [];
}

export async function getTrash(userId: string) {
  const { data } = await supabase()
    .from("documents")
    .select("id, title, userId, isArchived, isDraft, parentDocument, icon, isPublished, createdAt, updatedAt")
    .eq("userId", userId)
    .eq("isArchived", true)
    .order("createdAt", { ascending: false });

  return data || [];
}

export async function getSearch(userId: string) {
  const { data } = await supabase()
    .from("documents")
    .select("id, title, userId, isArchived, isDraft, parentDocument, icon, isPublished, createdAt, updatedAt")
    .eq("userId", userId)
    .eq("isArchived", false)
    .order("createdAt", { ascending: false });

  return data || [];
}

// 请求去重：Navbar 和 Page 同时请求同一个文档时共用同一个 promise
const pendingById = new Map<string, Promise<Document>>();
// 内存缓存：已加载过的文档不再重复请求；设大小上限防长期会话内存增长
const docCache = new Map<string, Document>();
const DOC_CACHE_MAX = 200;

export async function getById(documentId: string) {
  if (docCache.has(documentId)) return docCache.get(documentId)!;
  if (pendingById.has(documentId)) return pendingById.get(documentId)!;
  const promise = _getById(documentId).then((doc) => {
    // 超出上限时淘汰最旧条目（Map 迭代序 = 插入序）
    if (docCache.size >= DOC_CACHE_MAX) {
      const oldest = docCache.keys().next().value;
      if (oldest !== undefined) docCache.delete(oldest);
    }
    docCache.set(documentId, doc);
    return doc;
  });
  pendingById.set(documentId, promise);
  // 派生 promise 必须吞掉 rejection，否则主 promise reject 时产生 unhandled rejection
  promise.finally(() => pendingById.delete(documentId)).catch(() => {});
  return promise;
}

/**
 * 绕过缓存重新拉取文档：AI 的 updateNote 在服务端直接写库，
 * 不会经过本模块的 update()，docCache 仍存旧值，刷新标记触发时用此函数。
 */
export async function getByIdFresh(documentId: string) {
  docCache.delete(documentId);
  return getById(documentId);
}

/** 鼠标悬停预加载：后台静默拉取文档内容到缓存 */
export function prefetchById(documentId: string) {
  getById(documentId).catch(() => {});
}

async function _getById(documentId: string) {
  const { data, error } = await supabase()
    .from("documents")
    .select("*")
    .eq("id", documentId)
    .single();

  if (error || !data) throw new Error("Not found");
  return data as Document;
}

// ---- Mutations ----

export async function create(userId: string, title: string, parentDocument?: string | null) {
  const { data, error } = await supabase()
    .from("documents")
    .insert({
      title,
      userId,
      parentDocument: parentDocument || null,
      isArchived: false,
      isPublished: false,
    })
    .select("id")
    .single();

  if (error || !data) throw error;
  return data.id;
}

export async function update(id: string, fields: Partial<Pick<Document, "title" | "content" | "coverImage" | "icon" | "isPublished" | "isDraft">>) {
  const { error } = await supabase()
    .from("documents")
    .update(fields)
    .eq("id", id);

  if (error) throw error;
  docCache.delete(id); // 使缓存失效，下次 getById 重新拉取
}

export async function archive(userId: string, id: string) {
  // Recursively archive children first
  const { data: children } = await supabase()
    .from("documents")
    .select("id")
    .eq("userId", userId)
    .eq("parentDocument", id);

  if (children) {
    for (const child of children) {
      await archive(userId, child.id);
    }
  }

  const { error } = await supabase()
    .from("documents")
    .update({ isArchived: true })
    .eq("id", id);

  if (error) throw error;
  docCache.delete(id);
}

export async function restore(userId: string, id: string) {
  // Recursively restore children
  const { data: children } = await supabase()
    .from("documents")
    .select("id")
    .eq("userId", userId)
    .eq("parentDocument", id);

  if (children) {
    for (const child of children) {
      await restore(userId, child.id);
    }
  }

  // Check if parent is archived — if so, detach
  const { data: doc } = await supabase()
    .from("documents")
    .select("parentDocument")
    .eq("id", id)
    .single();

  const updateFields: Record<string, boolean | null> = { isArchived: false };
  if (doc?.parentDocument) {
    const { data: parent } = await supabase()
      .from("documents")
      .select("isArchived")
      .eq("id", doc.parentDocument)
      .single();
    if (parent?.isArchived) {
      updateFields.parentDocument = null;
    }
  }

  const { error } = await supabase()
    .from("documents")
    .update(updateFields)
    .eq("id", id);

  if (error) throw error;
  docCache.delete(id);
}

export async function remove(id: string) {
  const { error } = await supabase()
    .from("documents")
    .delete()
    .eq("id", id);

  if (error) throw error;
  docCache.delete(id);
}

export async function removeIcon(id: string) {
  const { error } = await supabase()
    .from("documents")
    .update({ icon: null })
    .eq("id", id);

  if (error) throw error;
  docCache.delete(id);
}

export async function removeCoverImage(id: string) {
  const { error } = await supabase()
    .from("documents")
    .update({ coverImage: null })
    .eq("id", id);

  if (error) throw error;
  docCache.delete(id);
}
