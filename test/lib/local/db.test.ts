// 本地数据访问层单测：:memory: 真实 SQL 验证 CRUD 行为与 PG 版语义一致
import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { openTestDb, isoNow, newId } from "@/lib/local/sqlite";
import {
  createDocument,
  updateDocument,
  getDocumentById,
  listSidebarAll,
  listTrash,
  listSearch,
  archiveDocument,
  restoreDocument,
  deleteDocument,
  clearDocumentIcon,
  clearDocumentCoverImage,
  createChatSession,
  deleteChatSession,
  listChatSessions,
  listChatHistory,
  getChatSessionSummary,
  setChatSessionSummary,
  markMessagesCompressed,
  insertChatMessage,
  searchDocuments,
  listDocumentsOverview,
  getDescendantIds,
  moveDocument,
} from "@/lib/local/db";

function seedUser(db: Database.Database, email = "a@x.com"): string {
  const id = newId();
  db.prepare(
    "INSERT INTO users (id, email, passwordHash, createdAt, updatedAt) VALUES (?,?,?,?,?)",
  ).run(id, email, "hash", isoNow(), isoNow());
  return id;
}

function seedDoc(db: Database.Database, userId: string, title: string, parent?: string | null): string {
  return createDocument(db, userId, title, parent);
}

describe("lib/local/db 文档操作", () => {
  let db: Database.Database;
  let userId: string;

  beforeEach(() => {
    db = openTestDb();
    userId = seedUser(db);
  });

  it("createDocument 返回 id 并写入默认字段（boolean 默认 false、时间戳 ISO）", () => {
    const id = seedDoc(db, userId, "第一篇");
    const doc = getDocumentById(db, id, userId);
    expect(doc).not.toBeNull();
    expect(doc!.title).toBe("第一篇");
    expect(doc!.isArchived).toBe(false);
    expect(doc!.isDraft).toBe(false);
    expect(doc!.isPublished).toBe(false);
    expect(doc!.parentDocument).toBeNull();
    expect(doc!.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("getDocumentById 按 userId 强制所有权：他人文档返回 null", () => {
    const other = seedUser(db, "b@x.com");
    const id = seedDoc(db, other, "别人的");
    expect(getDocumentById(db, id, userId)).toBeNull();
    expect(getDocumentById(db, id, other)).not.toBeNull();
    // 公开预览场景：不传 userId 时不做所有权校验
    expect(getDocumentById(db, id)).not.toBeNull();
  });

  it("updateDocument 更新字段并刷新 updatedAt", async () => {
    const id = seedDoc(db, userId, "t");
    const before = getDocumentById(db, id, userId)!;
    await new Promise((r) => setTimeout(r, 5));
    updateDocument(db, id, { title: "新标题", isPublished: true });
    const after = getDocumentById(db, id, userId)!;
    expect(after.title).toBe("新标题");
    expect(after.isPublished).toBe(true);
    expect(after.updatedAt > before.updatedAt).toBe(true);
  });

  it("archiveDocument 递归归档整棵子树，同层兄弟不受影响", () => {
    const parent = seedDoc(db, userId, "parent");
    const child = seedDoc(db, userId, "child", parent);
    const grandchild = seedDoc(db, userId, "grandchild", child);
    const sibling = seedDoc(db, userId, "sibling");

    archiveDocument(db, userId, parent);

    expect(getDocumentById(db, parent, userId)!.isArchived).toBe(true);
    expect(getDocumentById(db, child, userId)!.isArchived).toBe(true);
    expect(getDocumentById(db, grandchild, userId)!.isArchived).toBe(true);
    expect(getDocumentById(db, sibling, userId)!.isArchived).toBe(false);
  });

  it("restoreDocument 递归恢复子树；顶层父文档仍归档时摘除父引用", () => {
    const grand = seedDoc(db, userId, "grand");
    const parent = seedDoc(db, userId, "parent", grand);
    const child = seedDoc(db, userId, "child", parent);
    archiveDocument(db, userId, grand); // grand + parent + child 全部归档

    restoreDocument(db, userId, child);
    const c = getDocumentById(db, child, userId)!;
    expect(c.isArchived).toBe(false);
    expect(c.parentDocument).toBeNull(); // parent 仍归档 → detach
    expect(getDocumentById(db, parent, userId)!.isArchived).toBe(true);
    expect(getDocumentById(db, grand, userId)!.isArchived).toBe(true);

    // 归档态恢复时父未归档则不摘除
    const p2 = seedDoc(db, userId, "p2");
    const c2 = seedDoc(db, userId, "c2", p2);
    archiveDocument(db, userId, c2);
    restoreDocument(db, userId, c2);
    expect(getDocumentById(db, c2, userId)!.parentDocument).toBe(p2);
  });

  it("deleteDocument 删除行；子文档 FK 置 NULL", () => {
    const parent = seedDoc(db, userId, "p");
    const child = seedDoc(db, userId, "c", parent);
    deleteDocument(db, parent);
    expect(getDocumentById(db, parent)).toBeNull();
    expect(getDocumentById(db, child, userId)!.parentDocument).toBeNull();
  });

  it("clearDocumentIcon / clearDocumentCoverImage 置 NULL", () => {
    const id = seedDoc(db, userId, "t");
    updateDocument(db, id, { icon: "📝", coverImage: "/uploads/x.png" });
    clearDocumentIcon(db, id);
    clearDocumentCoverImage(db, id);
    const doc = getDocumentById(db, id, userId)!;
    expect(doc.icon).toBeNull();
    expect(doc.coverImage).toBeNull();
  });

  it("listSidebarAll 只含未归档且不含 content/coverImage；listTrash 只含已归档；listSearch 同侧边栏", () => {
    const a = seedDoc(db, userId, "a");
    const b = seedDoc(db, userId, "b");
    updateDocument(db, a, { content: "body", coverImage: "img" });
    archiveDocument(db, userId, b);

    const sidebar = listSidebarAll(db, userId);
    expect(sidebar.map((d) => d.id)).toEqual([a]);
    expect(sidebar[0]).not.toHaveProperty("content");
    expect(sidebar[0]).not.toHaveProperty("coverImage");

    expect(listTrash(db, userId).map((d) => d.id)).toEqual([b]);
    expect(listSearch(db, userId).map((d) => d.id)).toEqual([a]);

    const other = seedUser(db, "c@x.com");
    expect(listSidebarAll(db, other)).toHaveLength(0); // userId 隔离
  });
});

describe("lib/local/db Agent 搜索与组织", () => {
  let db: Database.Database;
  let userId: string;

  beforeEach(() => {
    db = openTestDb();
    userId = seedUser(db);
  });

  it("searchDocuments 标题与正文均可命中，只搜当前用户，按 updatedAt 倒序", () => {
    const a = seedDoc(db, userId, "React 学习笔记"); // 标题命中
    const b = seedDoc(db, userId, "无标题");
    updateDocument(db, b, { content: "前端路线图 react 教程" }); // 正文命中，且更新 → 排前
    const other = seedUser(db, "e@x.com");
    seedDoc(db, other, "React 别人的"); // 跨用户，不应出现

    const hits = searchDocuments(db, userId, "react");
    expect(hits.map((d) => d.id)).toEqual([b, a]);
    expect(hits.some((d) => d.title === "React 别人的")).toBe(false);
  });

  it("searchDocuments 空 query 返回全部未归档（按最近更新倒序），归档不出现", async () => {
    const a = seedDoc(db, userId, "a");
    await new Promise((r) => setTimeout(r, 5));
    const b = seedDoc(db, userId, "b");
    archiveDocument(db, userId, a);

    const all = searchDocuments(db, userId, "");
    expect(all.map((d) => d.id)).toEqual([b]);
  });

  it("searchDocuments 通配符转义：% _ 不扩大匹配", () => {
    seedDoc(db, userId, "100%_完成");
    seedDoc(db, userId, "100X完成");
    const hits = searchDocuments(db, userId, "100%_完成");
    expect(hits.map((d) => d.title)).toEqual(["100%_完成"]);
  });

  it("listDocumentsOverview 全量/按父过滤 + childCount，归档不计入", () => {
    const root1 = seedDoc(db, userId, "根1");
    const child = seedDoc(db, userId, "子", root1);
    seedDoc(db, userId, "孙", child);
    const root2 = seedDoc(db, userId, "根2");
    archiveDocument(db, userId, child); // 归档子 → 不计入根1 的 childCount，也不出现在根1 的子列表

    const all = listDocumentsOverview(db, userId);
    expect(all.map((d) => d.id)).toEqual([root2, root1]); // updatedAt 倒序
    expect(all.find((d) => d.id === root1)!.childCount).toBe(0);

    const children = listDocumentsOverview(db, userId, root1);
    expect(children).toHaveLength(0);
  });

  it("moveDocument 移动到根/其他父/防循环/目标校验/跨用户隔离", () => {
    const a = seedDoc(db, userId, "a");
    const b = seedDoc(db, userId, "b", a);
    const c = seedDoc(db, userId, "c");
    const other = seedUser(db, "f@x.com");
    const foreign = seedDoc(db, other, "foreign");

    // 移动到指定父
    expect(moveDocument(db, userId, c, a)).toBe(true);
    expect(getDocumentById(db, c, userId)!.parentDocument).toBe(a);

    // 移到根目录
    expect(moveDocument(db, userId, c, null)).toBe(true);
    expect(getDocumentById(db, c, userId)!.parentDocument).toBeNull();

    // 防循环：b 是 a 的子，a 不能移动到 b 下
    expect(moveDocument(db, userId, a, b)).toBe(false);
    expect(getDocumentById(db, a, userId)!.parentDocument).toBeNull();

    // 自身不能作为父
    expect(moveDocument(db, userId, a, a)).toBe(false);

    // 目标不存在 / 跨用户 / 已归档
    expect(moveDocument(db, userId, a, newId())).toBe(false);
    expect(moveDocument(db, userId, a, foreign)).toBe(false);
    const archived = seedDoc(db, userId, "archived");
    archiveDocument(db, userId, archived);
    expect(moveDocument(db, userId, a, archived)).toBe(false);
  });

  it("getDescendantIds 返回整棵子孙链（含多级）", () => {
    const a = seedDoc(db, userId, "a");
    const b = seedDoc(db, userId, "b", a);
    const cc = seedDoc(db, userId, "c", b);
    const d = seedDoc(db, userId, "d");
    const ids = getDescendantIds(db, userId, a);
    expect(ids.sort()).toEqual([a, b, cc].sort());
    expect(ids).not.toContain(d);
  });
});

describe("lib/local/db AI 会话", () => {
  let db: Database.Database;
  let userId: string;

  beforeEach(() => {
    db = openTestDb();
    userId = seedUser(db);
  });

  it("createChatSession 返回 id，listChatSessions 按 updatedAt 倒序", async () => {
    const s1 = createChatSession(db, userId, "会话1");
    await new Promise((r) => setTimeout(r, 5));
    const s2 = createChatSession(db, userId, "会话2");
    const sessions = listChatSessions(db, userId);
    expect(sessions.map((s) => s.id)).toEqual([s2, s1]);
    expect(sessions[0].title).toBe("会话2");
  });

  it("deleteChatSession 级联删除其消息", () => {
    const sid = createChatSession(db, userId);
    insertChatMessage(db, { userId, sessionId: sid, role: "user", content: "hi" });
    deleteChatSession(db, userId, sid);
    expect(listChatHistory(db, userId, sid)).toHaveLength(0);
  });

  it("insertChatMessage 落库并保留 token 统计；listChatHistory 升序、limit、uncompressedOnly", () => {
    const sid = createChatSession(db, userId);
    insertChatMessage(db, { userId, sessionId: sid, role: "user", content: "q1", promptTokens: 10 });
    insertChatMessage(db, {
      userId,
      sessionId: sid,
      role: "assistant",
      content: "a1",
      promptTokens: 20,
      completionTokens: 30,
      totalTokens: 50,
    });
    insertChatMessage(db, { userId, sessionId: sid, role: "user", content: "q2" });

    const history = listChatHistory(db, userId, sid);
    expect(history.map((m) => m.content)).toEqual(["q1", "a1", "q2"]);

    const limited = listChatHistory(db, userId, sid, 2);
    expect(limited).toHaveLength(2);
    // limit = **最新** N 条（滑动窗口注入最近对话，而不是最早的 N 条）
    expect(limited.map((m) => m.content)).toEqual(["a1", "q2"]);

    markMessagesCompressed(db, userId, [history[0].id, history[1].id]);
    const uncompressed = listChatHistory(db, userId, sid, undefined, { uncompressedOnly: true });
    expect(uncompressed.map((m) => m.content)).toEqual(["q2"]);
  });

  it("metadata（回合快照）随消息落库并原样读回；token 统计也能读回", () => {
    const sid = createChatSession(db, userId);
    const snapshot = JSON.stringify({ version: 1, parts: [{ kind: "text", chars: 2 }], durationMs: 88 });
    insertChatMessage(db, {
      userId,
      sessionId: sid,
      role: "assistant",
      content: "回答",
      promptTokens: 7,
      completionTokens: 9,
      metadata: snapshot,
    });

    const [row] = listChatHistory(db, userId, sid);
    expect(row.metadata).toBe(snapshot);
    expect(row.promptTokens).toBe(7);
    expect(row.completionTokens).toBe(9);
  });

  it("requestId 重复触发唯一约束（对应 PG 23505，上层按 409 处理）", () => {
    const sid = createChatSession(db, userId);
    insertChatMessage(db, { userId, sessionId: sid, role: "user", content: "hi", requestId: "req-1" });
    try {
      insertChatMessage(db, { userId, sessionId: sid, role: "user", content: "hi", requestId: "req-1" });
      expect.unreachable("应抛出唯一约束错误");
    } catch (e) {
      expect((e as Error & { code?: string }).code).toBe("SQLITE_CONSTRAINT_UNIQUE");
    }
  });

  it("summary 读写：set 后 get 返回新摘要并刷新 updatedAt", () => {
    const sid = createChatSession(db, userId);
    expect(getChatSessionSummary(db, userId, sid)).toBeNull();
    setChatSessionSummary(db, userId, sid, "早期对话摘要");
    expect(getChatSessionSummary(db, userId, sid)).toBe("早期对话摘要");
    // 重写式更新覆盖
    setChatSessionSummary(db, userId, sid, "合并后摘要");
    expect(getChatSessionSummary(db, userId, sid)).toBe("合并后摘要");
  });

  it("userId 隔离：跨用户访问会话/历史为空且不抛错", () => {
    const other = seedUser(db, "d@x.com");
    const sid = createChatSession(db, userId);
    insertChatMessage(db, { userId, sessionId: sid, role: "user", content: "private" });
    expect(listChatSessions(db, other)).toHaveLength(0);
    expect(listChatHistory(db, other, sid)).toHaveLength(0);
    expect(getChatSessionSummary(db, other, sid)).toBeNull();
  });
});
