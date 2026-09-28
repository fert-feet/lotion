// 统一数据访问层（客户端入口）。
// ⚠️ 本模块仅面向浏览器（组件/客户端代码）——全部通过 fetch 走本地 REST API
// （/api/documents/*、/api/chat/*，同源自动携带会话 cookie）。
// 服务端代码**不要** import 本模块：直接 import lib/local/db.ts（原生 SQLite 层），
// 两条入口函数语义一一对应（见 docs/本地数据库版.md 架构图）。

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

// ---- 内部工具 ----

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) {
    let message = `请求失败（${res.status}）`;
    try {
      const data = await res.json();
      if (data?.error) message = data.error;
    } catch {
      // 忽略解析失败，保留默认信息
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

// ---- AI 会话 ----

/** 列出当前用户全部会话（按最近更新倒序，最多 50 条） */
export async function getChatSessions(_userId: string): Promise<ChatSession[]> {
  return api<ChatSession[]>("/api/chat/sessions");
}

/** 新建会话，返回新会话 id */
export async function createChatSession(
  _userId: string,
  title = "新对话",
  documentId: string | null = null,
): Promise<string> {
  const { id } = await api<{ id: string }>("/api/chat/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title, documentId }),
  });
  return id;
}

/** 删除会话（消息级联删除） */
export async function deleteChatSession(_userId: string, sessionId: string) {
  await api(`/api/chat/sessions/${sessionId}`, { method: "DELETE" });
}

/** 拉取会话对话历史（按 createdAt 升序注入模型） */
export async function getChatHistory(
  _userId: string,
  sessionId: string,
  limit?: number,
): Promise<ChatMessage[]> {
  const qs = limit !== undefined ? `?limit=${limit}` : "";
  return api<ChatMessage[]>(`/api/chat/sessions/${sessionId}/messages${qs}`);
}

// ---- 文档 ----

/** 侧边栏全量文档（未归档，createdAt 倒序，不含 content/coverImage） */
export async function getSidebarAll(_userId: string): Promise<SidebarDocument[]> {
  return api<SidebarDocument[]>("/api/documents?scope=sidebar");
}

/** @deprecated 使用 getSidebarAll 替代 */
export async function getSidebar(_userId: string, parentDocument?: string | null) {
  const all = await api<SidebarDocument[]>("/api/documents?scope=sidebar");
  return all.filter((d) => (parentDocument ? d.parentDocument === parentDocument : d.parentDocument === null));
}

/** 回收站（已归档文档） */
export async function getTrash(_userId: string): Promise<SidebarDocument[]> {
  return api<SidebarDocument[]>("/api/documents?scope=trash");
}

/** 全局搜索候选（关键字过滤在客户端 search-command 完成） */
export async function getSearch(_userId: string): Promise<SidebarDocument[]> {
  return api<SidebarDocument[]>("/api/documents?scope=search");
}

// 请求去重：Navbar 和 Page 同时请求同一个文档时共用同一个 promise
const pendingById = new Map<string, Promise<Document>>();
// 内存缓存：已加载过的文档不再重复请求；设大小上限防长期会话内存增长
const docCache = new Map<string, Document>();
const DOC_CACHE_MAX = 200;

/** 单文档查询（带缓存/去重；所有权由 GET /api/documents/[id] 的会话鉴权保证） */
export async function getById(documentId: string) {
  if (docCache.has(documentId)) return docCache.get(documentId)!;
  if (pendingById.has(documentId)) return pendingById.get(documentId)!;
  const promise = api<Document>(`/api/documents/${documentId}`).then((doc) => {
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

/** 公开预览用：读取已发布文档（无鉴权端点，本地版"仅本机访问"语义） */
export async function getPublishedDocument(documentId: string): Promise<Document> {
  return api<Document>(`/api/public/documents/${documentId}`);
}

// ---- Mutations ----

export async function create(_userId: string, title: string, parentDocument?: string | null) {
  const { id } = await api<{ id: string }>("/api/documents", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title, parentDocument: parentDocument || null }),
  });
  return id;
}

export async function update(
  id: string,
  fields: Partial<Pick<Document, "title" | "content" | "coverImage" | "icon" | "isPublished" | "isDraft">>,
) {
  await api(`/api/documents/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(fields),
  });
  docCache.delete(id); // 使缓存失效，下次 getById 重新拉取
}

/** 重命名 AI 会话（AI 面板的历史会话列表） */
export async function setChatSessionTitle(sessionId: string, title: string) {
  await api(`/api/chat/sessions/${sessionId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title }),
  });
}

/**
 * 撤销某一轮 AI 请求对文档的隐式改动（AI 面板「撤销本次改动」）。
 */
export async function undoAiChanges(requestId: string) {
  return api<{ ok: boolean; restored: string[]; skipped: number }>("/api/ai/undo", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ requestId }),
  });
}

/** 某一轮 AI 改动的改动前后对照（AI 面板「查看改动」） */
export async function previewAiChanges(requestId: string) {
  return api<{
    changes: Array<{ documentId: string; title: string; beforeTitle: string; before: string; after: string }>;
  }>("/api/ai/undo/" + encodeURIComponent(requestId) + "/preview");
}

/**
 * 追加一段 Markdown 到文档末尾（AI 面板「插入到当前文档」）。
 * 转换（Markdown → BlockNote 块）在服务端做，客户端只发原文。
 */
export async function appendMarkdown(id: string, markdown: string) {
  await api(`/api/documents/${id}/append`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ markdown }),
  });
  docCache.delete(id); // 正文已变，缓存必须失效
}

export async function archive(_userId: string, id: string) {  await api(`/api/documents/${id}/archive`, { method: "PATCH" });
  docCache.delete(id);
}

export async function restore(_userId: string, id: string) {
  await api(`/api/documents/${id}/restore`, { method: "PATCH" });
  docCache.delete(id);
}

export async function move(id: string, parentDocument: string | null) {
  await api(`/api/documents/${id}/move`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ parentDocument }),
  });
  docCache.delete(id);
}

export async function remove(id: string) {
  await api(`/api/documents/${id}`, { method: "DELETE" });
  docCache.delete(id);
}

export async function removeIcon(id: string) {
  await api(`/api/documents/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ icon: null }),
  });
  docCache.delete(id);
}

export async function removeCoverImage(id: string) {
  await api(`/api/documents/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ coverImage: null }),
  });
  docCache.delete(id);
}

/** 测试专用：清空模块级缓存（单测隔离用） */
export function _resetDocCacheForTest() {
  docCache.clear();
  pendingById.clear();
}
