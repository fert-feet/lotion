// docStore 的宿主侧实现（Service Provider）：SQLite。
//
// ⚠️ 服务端专用（better-sqlite3 是原生模块，进客户端打包会炸 —— 由 test/boundary.test.ts 守卫）。
// 本文件只做**转发与 Actor 绑定**：所有 SQL 语义仍由 lib/local/db.ts 持有，
// 换实现（libsql / 远程）时替换本文件即可，消费方与契约都不用动。
import type Database from "better-sqlite3";
import { getDb } from "./sqlite";
import {
  archiveDocument,
  clearDocumentCoverImage,
  clearDocumentIcon,
  createChatSession,
  createDocument,
  deleteChatSession,
  deleteDocument,
  getDocumentById,
  insertChatMessage,
  listChatHistory,
  listChatSessions,
  listDocumentsOverview,
  listSearch,
  listSidebar,
  listSidebarAll,
  listTrash,
  moveDocument,
  restoreDocument,
  setChatSessionTitle,
  touchChatSession,
  updateDocument,
} from "./db";
import type {
  Actor,
  ChatMessageInput,
  DocStore,
  DocumentUpdateFields,
} from "@/lib/seams/doc-store";

/**
 * 用给定连接构造 docStore 实现（测试可注入 :memory: 库）。
 * @param db - SQLite 连接；省略时用进程单例（getDb）
 */
export function createSqliteDocStore(db?: Database.Database): DocStore {
  const conn = () => db ?? getDb();

  return {
    // ---- 文档读取 ----
    async listSidebarAll(actor: Actor) {
      return listSidebarAll(conn(), actor.userId);
    },
    async listSidebar(actor: Actor, parentDocument: string | null) {
      return listSidebar(conn(), actor.userId, parentDocument);
    },
    async listTrash(actor: Actor) {
      return listTrash(conn(), actor.userId);
    },
    async listSearch(actor: Actor) {
      return listSearch(conn(), actor.userId);
    },
    async getById(actor: Actor, id: string) {
      return getDocumentById(conn(), id, actor.userId);
    },
    async listOverview(actor: Actor, parentDocument: string | null) {
      return listDocumentsOverview(conn(), actor.userId, parentDocument);
    },

    // ---- 文档写入 ----
    async create(actor: Actor, title: string, parentDocument: string | null = null) {
      return createDocument(conn(), actor.userId, title, parentDocument);
    },
    async update(_actor: Actor, id: string, fields: DocumentUpdateFields) {
      updateDocument(conn(), id, fields);
    },
    async archive(actor: Actor, id: string) {
      archiveDocument(conn(), actor.userId, id);
    },
    async restore(actor: Actor, id: string) {
      restoreDocument(conn(), actor.userId, id);
    },
    async move(actor: Actor, id: string, parentDocument: string | null) {
      moveDocument(conn(), actor.userId, id, parentDocument);
    },
    async remove(_actor: Actor, id: string) {
      deleteDocument(conn(), id);
    },
    async removeIcon(_actor: Actor, id: string) {
      clearDocumentIcon(conn(), id);
    },
    async removeCoverImage(_actor: Actor, id: string) {
      clearDocumentCoverImage(conn(), id);
    },

    // ---- AI 会话 ----
    async listChatSessions(actor: Actor, limit?: number) {
      return listChatSessions(conn(), actor.userId, limit);
    },
    async createChatSession(actor: Actor, title?: string) {
      return createChatSession(conn(), actor.userId, title);
    },
    async deleteChatSession(actor: Actor, sessionId: string) {
      deleteChatSession(conn(), actor.userId, sessionId);
    },
    async listChatHistory(actor: Actor, sessionId: string, limit?: number) {
      return listChatHistory(conn(), actor.userId, sessionId, limit);
    },
    async insertChatMessage(actor: Actor, input: ChatMessageInput) {
      insertChatMessage(conn(), { ...input, userId: actor.userId });
    },
    async setChatSessionTitle(actor: Actor, sessionId: string, title: string) {
      setChatSessionTitle(conn(), actor.userId, sessionId, title);
    },
    async touchChatSession(actor: Actor, sessionId: string) {
      touchChatSession(conn(), actor.userId, sessionId);
    },
  };
}
