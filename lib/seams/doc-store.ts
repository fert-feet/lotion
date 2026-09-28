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
import { Context, provideService, readService } from "@/lib/kernel";

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
  /** assistant 消息的结构化快照 JSON（工具卡/副作用卡/引用/待办/提问/警告/耗时） */
  metadata?: string | null;
  promptTokens?: number;
  completionTokens?: number;
};

/** AI 改动前后对照（每篇被改文档一条） */
export type AiChangePreview = {
  documentId: string;
  title: string;
  beforeTitle: string;
  before: string;
  after: string;
};

export type ChatSession = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  /** 绑定的文档 id（null/未设置 = 全局会话） */
  documentId?: string | null;
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
  /** 结构化快照 JSON（assistant 消息携带，用于刷新后重建 turn 时间线） */
  metadata?: string | null;
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
  /** 公开预览读取：不带 Actor（只返回 isPublished 文档，未发布返回 null） */
  getPublishedById(id: string): Promise<Document | null>;
  /** 文档概览（含子文档数），供 AI 浏览类工具 */
  listOverview(actor: Actor, parentDocument: string | null): Promise<DocumentOverviewItem[]>;

  // ---- 文档写入 ----
  create(actor: Actor, title: string, parentDocument?: string | null): Promise<string>;
  update(actor: Actor, id: string, fields: DocumentUpdateFields): Promise<void>;
  /** 追加一段 Markdown 到文档末尾（AI 回答插入文档用；服务端负责 Markdown→块转换） */
  appendMarkdown(actor: Actor, id: string, markdown: string): Promise<void>;
  archive(actor: Actor, id: string): Promise<void>;
  restore(actor: Actor, id: string): Promise<void>;
  move(actor: Actor, id: string, parentDocument: string | null): Promise<void>;
  remove(actor: Actor, id: string): Promise<void>;
  removeIcon(actor: Actor, id: string): Promise<void>;
  removeCoverImage(actor: Actor, id: string): Promise<void>;

  // ---- AI 会话与 AI 改动 ----
  /** 撤销某一轮 AI 请求对文档的隐式改动（requestId 来自回合快照） */
  undoAiChanges(
    actor: Actor,
    requestId: string,
  ): Promise<{ restored: string[]; skipped: number }>;
  /** 某一轮 AI 改动的"改动前后"对照（Markdown 文本，用于预览"AI 改了什么"） */
  previewAiChanges(actor: Actor, requestId: string): Promise<AiChangePreview[]>;
  listChatSessions(actor: Actor, limit?: number): Promise<ChatSession[]>;
  createChatSession(actor: Actor, title?: string, documentId?: string | null): Promise<string>;
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
  "getPublishedById",
  "listOverview",
  "create",
  "update",
  "appendMarkdown",
  "archive",
  "restore",
  "move",
  "remove",
  "removeIcon",
  "removeCoverImage",
  "undoAiChanges",
  "previewAiChanges",
  "listChatSessions",
  "createChatSession",
  "deleteChatSession",
  "listChatHistory",
  "insertChatMessage",
  "setChatSessionTitle",
  "touchChatSession",
] as const satisfies readonly (keyof DocStore)[];

/**
 * 仅宿主侧存在的写操作：浏览器不直连数据库，这些由服务端路由 / AI 端点负责。
 * 把它们从 UI 消费面里去掉，而不是让浏览器实现"假装能做"的方法。
 */
const HOST_ONLY_METHODS = [
  "insertChatMessage",
  "touchChatSession",
] as const satisfies readonly (keyof DocStore)[];

/**
 * UI 消费面：浏览器可实现的能力子集（Provider = lib/client/doc-store-rest.ts）。
 * `prefetch` 是**客户端可选**的缓存预热提示（宿主侧无意义，故不进完整契约）。
 */
export type UiDocStore = Omit<DocStore, (typeof HOST_ONLY_METHODS)[number]> & {
  prefetch?(actor: Actor, id: string): void;
};

/** UI 侧需要校验的方法清单（由上面两份清单派生，不手工重复） */
const UI_DOC_STORE_METHODS = DOC_STORE_METHODS.filter(
  (name) => !(HOST_ONLY_METHODS as readonly string[]).includes(name),
);

/** 服务 key（一个 key 一个提供方；重复注册由内核抛错） */
export const DOC_STORE_SERVICE = "docStore";

/**
 * 装配 docStore 实现（宿主侧）：**就地**校验方法完整性，缺方法立刻抛错。
 * @throws 缺少方法时抛错（错误信息列出全部缺失方法名）
 */
export function provideDocStore(ctx: Context, store: DocStore): void {
  assertShape(store, DOC_STORE_METHODS);
  provideService(ctx, DOC_STORE_SERVICE, store);
}

/** 装配 docStore 实现（浏览器侧）：只要求 UI 子集完整 */
export function provideUiDocStore(ctx: Context, store: UiDocStore): void {
  assertShape(store, UI_DOC_STORE_METHODS);
  provideService(ctx, DOC_STORE_SERVICE, store);
}

/** 读 docStore（宿主侧完整契约）；未装配返回 undefined（可选依赖降级用） */
export function findDocStore(ctx: Context): DocStore | undefined {
  return readService<DocStore>(ctx, DOC_STORE_SERVICE);
}

/** 读 docStore（宿主侧完整契约）；未装配抛错（必需依赖用） */
export function requireDocStore(ctx: Context): DocStore {
  return require_<DocStore>(ctx);
}

/** 读 docStore（浏览器侧 UI 子集）；未装配返回 undefined */
export function findUiDocStore(ctx: Context): UiDocStore | undefined {
  return readService<UiDocStore>(ctx, DOC_STORE_SERVICE);
}

/** 读 docStore（浏览器侧 UI 子集）；未装配抛错 */
export function requireUiDocStore(ctx: Context): UiDocStore {
  return require_<UiDocStore>(ctx);
}

function require_<T>(ctx: Context): T {
  const store = readService<T>(ctx, DOC_STORE_SERVICE);
  if (!store) {
    throw new Error(
      `docStore 未装配：请确认组合清单里挂载了 docStore 提供方插件（服务 key「${DOC_STORE_SERVICE}」）`,
    );
  }
  return store;
}

/** 校验实现是否具备清单里的全部方法（就地失败，不留半个服务） */
function assertShape(store: object, methods: readonly string[]): void {
  const missing = methods.filter(
    (name) => typeof (store as unknown as Record<string, unknown>)[name] !== "function",
  );
  if (missing.length > 0) {
    throw new Error(`docStore 实现不完整，缺少方法：${missing.join("、")}`);
  }
}
