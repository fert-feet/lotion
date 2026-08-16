// 统一数据访问层（T6：环境分派适配器）。
// - 服务端（typeof window === "undefined"）：直查本地 SQLite（动态 import 本地层，
//   避免 better-sqlite3 进入客户端打包）
// - 客户端：fetch 本地 REST API（/api/documents/*、/api/chat/*，同源自动带会话 cookie）
// 函数签名与旧 Supabase 版保持一致，组件层无需感知底层变化。

/** 运行时环境判断（用函数而非模块常量：单测可 stub window 切换客户端分支） */
function isServer(): boolean {
  return typeof window === "undefined";
}

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

// ---- 内部工具 ----

// 本地模块只动态 import 一次并缓存（避免每次调用重复解析模块；
// 也规避测试环境下动态 import 多次解析到不同模块实例的问题）。
// getDb() 每次实时调用：生产为单例连接，测试可随时替换注入的内存库。
let serverModulesPromise: Promise<{
  getDb: () => import("better-sqlite3").Database;
  local: typeof import("@/lib/local/db");
}> | null = null;

function serverModules() {
  if (!serverModulesPromise) {
    serverModulesPromise = Promise.all([
      import("@/lib/local/sqlite"),
      import("@/lib/local/db"),
    ]).then(([sqlite, local]) => ({ getDb: sqlite.getDb, local }));
  }
  return serverModulesPromise;
}

async function serverLocal() {
  const { getDb, local } = await serverModules();
  return { db: getDb(), local };
}

/** 测试专用：重置本地模块缓存（模块级 import 只做一次，测试间无需清理，保留备用） */
export function _resetServerModulesForTest() {
  serverModulesPromise = null;
}

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

function clientOnly(name: string): never {
  throw new Error(`${name} 仅服务端可用（客户端请勿调用）`);
}

// ---- AI 会话 ----

/** 列出当前用户全部会话（按最近更新倒序，最多 50 条） */
export async function getChatSessions(userId: string): Promise<ChatSession[]> {
  if (isServer()) {
    const { db, local } = await serverLocal();
    return local.listChatSessions(db, userId);
  }
  return api<ChatSession[]>("/api/chat/sessions");
}

/** 新建会话，返回新会话 id */
export async function createChatSession(userId: string, title = "新对话"): Promise<string> {
  if (isServer()) {
    const { db, local } = await serverLocal();
    return local.createChatSession(db, userId, title);
  }
  const { id } = await api<{ id: string }>("/api/chat/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title }),
  });
  return id;
}

/** 删除会话（消息级联删除） */
export async function deleteChatSession(userId: string, sessionId: string) {
  if (isServer()) {
    const { db, local } = await serverLocal();
    local.deleteChatSession(db, userId, sessionId);
    return;
  }
  await api(`/api/chat/sessions/${sessionId}`, { method: "DELETE" });
}

/**
 * 拉取会话对话历史（按 createdAt 升序注入模型）。
 * opts.uncompressedOnly 仅服务端压缩链路使用；客户端调用时忽略。
 */
export async function getChatHistory(
  userId: string,
  sessionId: string,
  limit?: number,
  opts: { uncompressedOnly?: boolean } = {},
): Promise<ChatMessage[]> {
  if (isServer()) {
    const { db, local } = await serverLocal();
    return local.listChatHistory(db, userId, sessionId, limit, opts);
  }
  const qs = limit !== undefined ? `?limit=${limit}` : "";
  return api<ChatMessage[]>(`/api/chat/sessions/${sessionId}/messages${qs}`);
}

/** 读取会话压缩摘要（仅服务端：压缩链路使用） */
export async function getChatSessionSummary(userId: string, sessionId: string): Promise<string | null> {
  if (!isServer()) return clientOnly("getChatSessionSummary");
  const { db, local } = await serverLocal();
  return local.getChatSessionSummary(db, userId, sessionId);
}

/** 重写式更新会话压缩摘要（仅服务端） */
export async function updateChatSessionSummary(userId: string, sessionId: string, summary: string) {
  if (!isServer()) return clientOnly("updateChatSessionSummary");
  const { db, local } = await serverLocal();
  local.setChatSessionSummary(db, userId, sessionId, summary);
}

/** 批量标记消息已压缩（仅服务端） */
export async function markMessagesCompressed(userId: string, ids: string[]) {
  if (!isServer()) return clientOnly("markMessagesCompressed");
  const { db, local } = await serverLocal();
  local.markMessagesCompressed(db, userId, ids);
}

/** 读取会话（含标题与摘要，仅服务端：AI 路由归属校验用） */
export async function getChatSession(userId: string, sessionId: string) {
  if (!isServer()) return clientOnly("getChatSession");
  const { db, local } = await serverLocal();
  return local.getChatSession(db, userId, sessionId);
}

/** 更新会话标题（仅服务端：首个问题自动命名） */
export async function setChatSessionTitle(userId: string, sessionId: string, title: string) {
  if (!isServer()) return clientOnly("setChatSessionTitle");
  const { db, local } = await serverLocal();
  local.setChatSessionTitle(db, userId, sessionId, title);
}

/** 刷新会话 updatedAt（仅服务端：新消息到达时） */
export async function touchChatSession(userId: string, sessionId: string) {
  if (!isServer()) return clientOnly("touchChatSession");
  const { db, local } = await serverLocal();
  local.touchChatSession(db, userId, sessionId);
}

/**
 * 落库一条聊天消息（仅服务端：AI 链路写入）。
 * requestId 重复时抛出 SQLite 唯一约束错误（code = SQLITE_CONSTRAINT_UNIQUE），
 * 调用方据此返回 409。
 */
export async function insertChatMessage(input: ChatMessageInput) {
  if (!isServer()) return clientOnly("insertChatMessage");
  const { db, local } = await serverLocal();
  local.insertChatMessage(db, input);
}

// ---- 文档 ----

/** 侧边栏全量文档（未归档，createdAt 倒序，不含 content/coverImage） */
export async function getSidebarAll(userId: string): Promise<SidebarDocument[]> {
  if (isServer()) {
    const { db, local } = await serverLocal();
    return local.listSidebarAll(db, userId);
  }
  return api<SidebarDocument[]>("/api/documents?scope=sidebar");
}

/** @deprecated 使用 getSidebarAll 替代 */
export async function getSidebar(userId: string, parentDocument?: string | null) {
  if (isServer()) {
    const { db, local } = await serverLocal();
    return local.listSidebar(db, userId, parentDocument);
  }
  const all = await api<SidebarDocument[]>("/api/documents?scope=sidebar");
  return all.filter((d) => (parentDocument ? d.parentDocument === parentDocument : d.parentDocument === null));
}

/** 回收站（已归档文档） */
export async function getTrash(userId: string): Promise<SidebarDocument[]> {
  if (isServer()) {
    const { db, local } = await serverLocal();
    return local.listTrash(db, userId);
  }
  return api<SidebarDocument[]>("/api/documents?scope=trash");
}

/** 全局搜索候选（关键字过滤在客户端 search-command 完成） */
export async function getSearch(userId: string): Promise<SidebarDocument[]> {
  if (isServer()) {
    const { db, local } = await serverLocal();
    return local.listSearch(db, userId);
  }
  return api<SidebarDocument[]>("/api/documents?scope=search");
}

// 请求去重：Navbar 和 Page 同时请求同一个文档时共用同一个 promise
const pendingById = new Map<string, Promise<Document>>();
// 内存缓存：已加载过的文档不再重复请求；设大小上限防长期会话内存增长
const docCache = new Map<string, Document>();
const DOC_CACHE_MAX = 200;

/**
 * 单文档查询（带缓存/去重）。
 * 客户端分支走带鉴权的 GET /api/documents/[id]；服务端分支不校验所有权
 * （仅公开预览页使用，该页自行校验 isPublished）。
 */
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

async function _getById(documentId: string): Promise<Document> {
  if (isServer()) {
    const { db, local } = await serverLocal();
    const doc = local.getDocumentById(db, documentId);
    if (!doc) throw new Error("Not found");
    return doc;
  }
  return api<Document>(`/api/documents/${documentId}`);
}

/**
 * 公开预览用：读取已发布文档（无鉴权端点，本地版"仅本机访问"语义）。
 * 服务端分支同样校验 isPublished，防止绕过。
 */
export async function getPublishedDocument(documentId: string): Promise<Document> {
  if (isServer()) {
    const { db, local } = await serverLocal();
    const doc = local.getDocumentById(db, documentId);
    if (!doc || !doc.isPublished) throw new Error("Not found");
    return doc;
  }
  return api<Document>(`/api/public/documents/${documentId}`);
}

// ---- Mutations ----

export async function create(userId: string, title: string, parentDocument?: string | null) {
  if (isServer()) {
    const { db, local } = await serverLocal();
    return local.createDocument(db, userId, title, parentDocument);
  }
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
  if (isServer()) {
    const { db, local } = await serverLocal();
    local.updateDocument(db, id, fields);
  } else {
    await api(`/api/documents/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(fields),
    });
  }
  docCache.delete(id); // 使缓存失效，下次 getById 重新拉取
}

export async function archive(userId: string, id: string) {
  if (isServer()) {
    const { db, local } = await serverLocal();
    local.archiveDocument(db, userId, id);
  } else {
    await api(`/api/documents/${id}/archive`, { method: "PATCH" });
  }
  docCache.delete(id);
}

export async function restore(userId: string, id: string) {
  if (isServer()) {
    const { db, local } = await serverLocal();
    local.restoreDocument(db, userId, id);
  } else {
    await api(`/api/documents/${id}/restore`, { method: "PATCH" });
  }
  docCache.delete(id);
}

export async function remove(id: string) {
  if (isServer()) {
    const { db, local } = await serverLocal();
    local.deleteDocument(db, id);
  } else {
    await api(`/api/documents/${id}`, { method: "DELETE" });
  }
  docCache.delete(id);
}

export async function removeIcon(id: string) {
  if (isServer()) {
    const { db, local } = await serverLocal();
    local.clearDocumentIcon(db, id);
  } else {
    await api(`/api/documents/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ icon: null }),
    });
  }
  docCache.delete(id);
}

export async function removeCoverImage(id: string) {
  if (isServer()) {
    const { db, local } = await serverLocal();
    local.clearDocumentCoverImage(db, id);
  } else {
    await api(`/api/documents/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ coverImage: null }),
    });
  }
  docCache.delete(id);
}

/** 测试专用：清空模块级缓存（单测隔离用） */
export function _resetDocCacheForTest() {
  docCache.clear();
  pendingById.clear();
}
