// docStore 的浏览器侧实现（Service Provider）：REST /api/*。
//
// ⚠️ 仅面向浏览器：全部请求同源 fetch（cookie 承载身份），**不要**在服务端 import。
// 与宿主侧对称：本文件只做**转发与 Actor 绑定**，HTTP 语义由 lib/db.ts 持有。
//
// Actor 说明：浏览器侧身份由会话 cookie 决定，lib/db.ts 的方法本来就不接受 userId，
// 因此这里的 actor 参数被有意忽略 —— 契约保留它，是为了两侧消费方写法一致。
import type { PluginObject } from "@/lib/kernel";
import {
  archive,
  create,
  createChatSession,
  deleteChatSession,
  getById,
  getByIdFresh,
  getPublishedDocument,
  getChatHistory,
  getChatSessions,
  getSearch,
  getSidebar,
  getSidebarAll,
  getTrash,
  move,
  prefetchById,
  remove,
  removeCoverImage,
  removeIcon,
  restore,
  update,
} from "@/lib/db";
import {
  provideUiDocStore,
  type DocumentUpdateFields,
  type UiDocStore,
} from "@/lib/seams/doc-store";

/**
 * 用 REST 端点构造 docStore 实现（浏览器侧 UI 子集）。
 * 不传任何依赖：连接信息就是同源 cookie。
 */
export function createRestDocStore(): UiDocStore {
  return {
    // ---- 文档读取 ----
    async listSidebarAll() {
      return getSidebarAll("");
    },
    async listSidebar(_actor, parentDocument: string | null) {
      return getSidebar("", parentDocument);
    },
    async listTrash() {
      return getTrash("");
    },
    async listSearch() {
      return getSearch("");
    },
    async getById(_actor, id: string, options?: { fresh?: boolean }) {
      return options?.fresh ? getByIdFresh(id) : getById(id);
    },
    async getPublishedById(id: string) {
      return getPublishedDocument(id);
    },
    // 缓存预热提示（客户端可选能力：宿主侧不需要）
    prefetch(_actor, id: string) {
      prefetchById(id);
    },
    // 浏览器没有 overview 端点：由全量列表派生（childCount 用父子关系就地统计）
    async listOverview(_actor, parentDocument: string | null) {
      const all = await getSidebarAll("");
      const children = all.filter((doc) =>
        parentDocument ? doc.parentDocument === parentDocument : doc.parentDocument == null,
      );
      return children.map((doc) => ({
        id: doc.id,
        title: doc.title,
        updatedAt: doc.updatedAt,
        childCount: all.filter((child) => child.parentDocument === doc.id).length,
      }));
    },

    // ---- 文档写入 ----
    async create(_actor, title: string, parentDocument: string | null = null) {
      return create("", title, parentDocument);
    },
    async update(_actor, id: string, fields: DocumentUpdateFields) {
      await update(id, fields);
    },
    async archive(_actor, id: string) {
      await archive("", id);
    },
    async restore(_actor, id: string) {
      await restore("", id);
    },
    async move(_actor, id: string, parentDocument: string | null) {
      await move(id, parentDocument);
    },
    async remove(_actor, id: string) {
      await remove(id);
    },
    async removeIcon(_actor, id: string) {
      await removeIcon(id);
    },
    async removeCoverImage(_actor, id: string) {
      await removeCoverImage(id);
    },

    // ---- AI 会话 ----
    async listChatSessions() {
      return getChatSessions("");
    },
    async createChatSession(_actor, title?: string) {
      return createChatSession("", title);
    },
    async deleteChatSession(_actor, sessionId: string) {
      await deleteChatSession("", sessionId);
    },
    async listChatHistory(_actor, sessionId: string, limit?: number) {
      return getChatHistory("", sessionId, limit);
    },
  };
}

/** 装配插件：把浏览器侧 docStore 挂到内核上（组合清单里的一行） */
export const restDocStorePlugin: PluginObject = {
  name: "doc-store-rest",
  apply(ctx) {
    provideUiDocStore(ctx, createRestDocStore());
  },
};
