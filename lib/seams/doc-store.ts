// 接缝：docStore —— 文档 / AI 会话数据存取的能力定义（Service Definition）。
//
// 三角色（对齐 DSH docs/architecture.zh.md:104）：
//   Definition  ← 本文件：契约类型 + 运行期服务 key + 装配校验
//   Provider    ← lib/local/doc-store-sqlite.ts（宿主：SQLite）
//                 lib/client/doc-store-rest.ts（浏览器：REST /api/*）
//   Consumer    ← 页面、UI 组件、AI 工具
//
// 为什么 Definition **不是**纯 `interface`：接口只有类型、没有运行期身份。
// 契约必须拥有一个真实的 `ctx.docStore` key 与"实现是否合规"的校验，
// 否则"换实现"就退回成"改 import 路径"。校验在装配时**就地**失败（不等首次请求）。
//
// ⚠️ 本模块必须保持**环境无关**（浏览器/服务端共用）：不得 import node:/better-sqlite3/React。
import { Context } from "@/lib/kernel";

/** 操作主体：本地单机版里就是当前会话用户；多用户/角色扩展时在此加字段 */
export interface Actor {
  userId: string;
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

/** 侧边栏/列表用：不含 content 与 coverImage */
export type SidebarDocument = Omit<Document, "content" | "coverImage">;

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
};

export type ChatSession = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

/** 可更新字段白名单（与 REST PATCH 白名单一致） */
export type DocumentUpdateFields = Partial<
  Pick<Document, "title" | "content" | "coverImage" | "icon" | "isPublished" | "isDraft">
>;

/** 消息写入（userId 由 Actor 提供，不由调用方传） */
export type ChatMessageInput = {
  sessionId?: string | null;
  role: "user" | "assistant";
  content: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  requestId?: string;
};

/** 文档列表项（含子文档数，供目录/浏览类消费方） */
export type DocumentOverviewItem = {
  id: string;
  title: string;
  updatedAt: string;
  childCount: number;
};

/**
 * docStore 契约：所有方法都以 `Actor` 显式标识操作主体。
 * （宿主侧据此做 SQL 过滤；浏览器侧 cookie 已承载身份，实现里忽略该参数即可。）
 */
export interface DocStore {
  // ---- 文档读取 ----
  /** 全部未归档文档（侧边栏/搜索候选） */
  listSidebarAll(actor: Actor): Promise<SidebarDocument[]>;
  /** 指定父文档下的子文档（parentDocument = null 表示根目录） */
  listSidebar(actor: Actor, parentDocument: string | null): Promise<SidebarDocument[]>;
  /** 回收站（已归档）文档 */
  listTrash(actor: Actor): Promise<SidebarDocument[]>;
  /** 搜索候选（全部未归档文档，标题匹配在消费方做） */
  listSearch(actor: Actor): Promise<SidebarDocument[]>;
  /** 单文档（含 content）；`fresh` 表示绕过缓存 */
  getById(actor: Actor, id: string, options?: { fresh?: boolean }): Promise<Document | null>;
  /** 文档概览（含子文档数），供 AI 浏览类工具 */
  listOverview(actor: Actor, parentDocument: string | null): Promise<DocumentOverviewItem[]>;

  // ---- 文档写入 ----
  create(actor: Actor, title: string, parentDocument?: string | null): Promise<string>;
  update(actor: Actor, id: string, fields: DocumentUpdateFields): Promise<void>;
  archive(actor: Actor, id: string): Promise<void>;
  restore(actor: Actor, id: string): Promise<void>;
  move(actor: Actor, id: string, parentDocument: string | null): Promise<void>;
  remove(actor: Actor, id: string): Promise<void>;
  removeIcon(actor: Actor, id: string): Promise<void>;
  removeCoverImage(actor: Actor, id: string): Promise<void>;

  // ---- AI 会话 ----
  listChatSessions(actor: Actor, limit?: number): Promise<ChatSession[]>;
  createChatSession(actor: Actor, title?: string): Promise<string>;
  deleteChatSession(actor: Actor, sessionId: string): Promise<void>;
  listChatHistory(actor: Actor, sessionId: string, limit?: number): Promise<ChatMessage[]>;
  insertChatMessage(actor: Actor, input: ChatMessageInput): Promise<void>;
  setChatSessionTitle(actor: Actor, sessionId: string, title: string): Promise<void>;
  touchChatSession(actor: Actor, sessionId: string): Promise<void>;
}

/** 契约方法清单：既是类型级完整性检查（少写/写错方法名 tsc 报错），也是装配期校验依据 */
const DOC_STORE_METHODS = [
  "listSidebarAll",
  "listSidebar",
  "listTrash",
  "listSearch",
  "getById",
  "listOverview",
  "create",
  "update",
  "archive",
  "restore",
  "move",
  "remove",
  "removeIcon",
  "removeCoverImage",
  "listChatSessions",
  "createChatSession",
  "deleteChatSession",
  "listChatHistory",
  "insertChatMessage",
  "setChatSessionTitle",
  "touchChatSession",
] as const satisfies readonly (keyof DocStore)[];

/** 服务 key（一个 key 一个提供方；重复注册由内核抛错） */
export const DOC_STORE_SERVICE = "docStore";

/**
 * 装配 docStore 实现：**就地**校验方法完整性，缺方法立刻抛错。
 * @throws 缺少方法时抛错（错误信息列出全部缺失方法名）
 */
export function provideDocStore(ctx: Context, store: DocStore): void {
  const missing = DOC_STORE_METHODS.filter(
    (name) => typeof (store as unknown as Record<string, unknown>)[name] !== "function",
  );
  if (missing.length > 0) {
    throw new Error(`docStore 实现不完整，缺少方法：${missing.join("、")}`);
  }
  ctx.provide(DOC_STORE_SERVICE, store);
}

/** 读 docStore；未装配返回 undefined（可选依赖降级用） */
export function findDocStore(ctx: Context): DocStore | undefined {
  return ctx.get<DocStore>(DOC_STORE_SERVICE);
}

/** 读 docStore；未装配抛错（必需依赖用，错误信息指明缺哪一行装配） */
export function requireDocStore(ctx: Context): DocStore {
  const store = findDocStore(ctx);
  if (!store) {
    throw new Error(`docStore 未装配：请确认组合清单里挂载了 docStore 提供方插件（服务 key「${DOC_STORE_SERVICE}」）`);
  }
  return store;
}
