// lib/db.ts 环境分派适配器单测：
// - 服务端分支：mock getDb 指向真实内存 SQLite，验证分派到本地层的行为
// - 客户端分支：stub window + fetch，验证 REST URL/方法/错误处理
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type Database from "better-sqlite3";
import {
  getSidebarAll,
  getTrash,
  getSearch,
  getById,
  getByIdFresh,
  create,
  update,
  archive,
  restore,
  remove,
  removeIcon,
  removeCoverImage,
  getChatSessions,
  createChatSession,
  deleteChatSession,
  getChatHistory,
  getChatSessionSummary,
  updateChatSessionSummary,
  markMessagesCompressed,
  insertChatMessage,
  _resetDocCacheForTest,
} from "@/lib/db";

const state = vi.hoisted(() => ({ db: null as Database.Database | null }));

vi.mock("@/lib/local/sqlite", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/local/sqlite")>();
  return { ...actual, getDb: () => state.db! };
});

vi.mock("@/lib/logger", () => {
  const noop = () => {};
  const ns = new Proxy({}, { get: () => noop });
  return { logger: { api: ns, agent: ns, tools: ns, db: ns, compress: ns } };
});

async function freshDb(): Promise<Database.Database> {
  const { initDatabase } = await import("@/lib/local/sqlite");
  const { default: Database } = await import("better-sqlite3");
  const db = new Database(":memory:");
  initDatabase(db);
  return db;
}

/** 在测试库种一个用户（本地层多文档操作需要外键） */
async function seedUser(db: Database.Database, email = "a@x.com"): Promise<string> {
  const { createUser } = await import("@/lib/local/auth");
  return createUser(db, email, "password123").id;
}

beforeEach(async () => {
  state.db = await freshDb();
  _resetDocCacheForTest();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---- 服务端分支（node 环境默认走此分支） ----

describe("lib/db 服务端分派（直查 SQLite）", () => {
  it("getSidebarAll/getTrash/getSearch 正确分派（归档过滤）", async () => {
    const userId = await seedUser(state.db!);
    const a = await create(userId, "a");
    const b = await create(userId, "b");
    await archive(userId, b);

    const sidebar = await getSidebarAll(userId);
    expect(sidebar.map((d) => d.id)).toEqual([a]);
    expect(sidebar[0]).not.toHaveProperty("content");

    expect((await getTrash(userId)).map((d) => d.id)).toEqual([b]);
    expect((await getSearch(userId)).map((d) => d.id)).toEqual([a]);
  });

  it("create/update/archive/restore/remove/removeIcon/removeCoverImage 写库", async () => {
    const userId = await seedUser(state.db!);
    const id = await create(userId, "标题");
    await update(id, { title: "新标题", isPublished: true });
    expect((await getById(id)).title).toBe("新标题");

    await update(id, { icon: "📝" });
    expect((await getById(id)).icon).toBe("📝");
    await removeIcon(id);
    expect((await getById(id)).icon).toBeNull();

    await archive(userId, id);
    expect((await getById(id)).isArchived).toBe(true);
    await restore(userId, id);
    expect((await getById(id)).isArchived).toBe(false);

    await update(id, { coverImage: "/uploads/x.png" });
    await removeCoverImage(id);
    expect((await getById(id)).coverImage).toBeNull();

    await remove(id);
    await expect(getById(id)).rejects.toThrow("Not found");
  });

  it("getById 缓存生效：直改库后仍返回旧值，getByIdFresh 绕过缓存", async () => {
    const userId = await seedUser(state.db!);
    const id = await create(userId, "标题");
    const first = await getById(id);
    expect(first.title).toBe("标题");

    // 模拟 AI 服务端直写（不经 lib/db.ts update）
    const { updateDocument } = await import("@/lib/local/db");
    updateDocument(state.db!, id, { title: "服务端直写" });

    expect((await getById(id)).title).toBe("标题"); // 命中缓存
    expect((await getByIdFresh(id)).title).toBe("服务端直写"); // 绕过缓存
  });

  it("chat 函数正确分派（会话 CRUD + 历史 + 压缩链路）", async () => {
    const userId = await seedUser(state.db!);
    const sid = await createChatSession(userId, "会话");
    expect(await getChatSessions(userId)).toHaveLength(1);

    await insertChatMessage({ userId, sessionId: sid, role: "user", content: "q" });
    await insertChatMessage({ userId, sessionId: sid, role: "assistant", content: "a" });
    const history = await getChatHistory(userId, sid);
    expect(history.map((m) => m.content)).toEqual(["q", "a"]);

    expect(await getChatSessionSummary(userId, sid)).toBeNull();
    await updateChatSessionSummary(userId, sid, "摘要");
    expect(await getChatSessionSummary(userId, sid)).toBe("摘要");

    await markMessagesCompressed(userId, history.map((m) => m.id));
    const uncompressed = await getChatHistory(userId, sid, undefined, { uncompressedOnly: true });
    expect(uncompressed).toHaveLength(0);

    await deleteChatSession(userId, sid);
    expect(await getChatSessions(userId)).toHaveLength(0);
  });

  it("insertChatMessage 重复 requestId 抛出 SQLITE_CONSTRAINT_UNIQUE", async () => {
    const userId = await seedUser(state.db!);
    const sid = await createChatSession(userId);
    await insertChatMessage({ userId, sessionId: sid, role: "user", content: "x", requestId: "r1" });
    await expect(
      insertChatMessage({ userId, sessionId: sid, role: "user", content: "x", requestId: "r1" }),
    ).rejects.toMatchObject({ code: "SQLITE_CONSTRAINT_UNIQUE" });
  });
});

// ---- 客户端分支（stub window → 走 fetch） ----

describe("lib/db 客户端分派（fetch REST）", () => {
  const fetchMock = vi.fn();

  function jsonRes(data: unknown, ok = true, status = 200) {
    return new Response(JSON.stringify(data), {
      status,
      headers: { "content-type": "application/json" },
    });
  }

  beforeEach(() => {
    vi.stubGlobal("window", { location: { href: "http://localhost" } });
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });

  it("文档列表/创建/更新/归档/恢复/删除走对应 REST 端点", async () => {
    fetchMock.mockResolvedValueOnce(jsonRes([])); // sidebar
    await getSidebarAll("u1");
    expect(fetchMock).toHaveBeenLastCalledWith("/api/documents?scope=sidebar", undefined);

    fetchMock.mockResolvedValueOnce(jsonRes({ id: "d1" }));
    const id = await create("u1", "t", "p");
    expect(id).toBe("d1");
    const createCall = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(createCall[0]).toBe("/api/documents");
    expect(JSON.parse(createCall[1].body as string)).toEqual({ title: "t", parentDocument: "p" });

    fetchMock.mockResolvedValueOnce(jsonRes({ ok: true }));
    await update("d1", { title: "x" });
    const patchCall = fetchMock.mock.calls[2] as [string, RequestInit];
    expect(patchCall[0]).toBe("/api/documents/d1");
    expect(patchCall[1].method).toBe("PATCH");

    fetchMock.mockResolvedValueOnce(jsonRes({ ok: true }));
    await archive("u1", "d1");
    expect(fetchMock.mock.calls[3][0]).toBe("/api/documents/d1/archive");

    fetchMock.mockResolvedValueOnce(jsonRes({ ok: true }));
    await restore("u1", "d1");
    expect(fetchMock.mock.calls[4][0]).toBe("/api/documents/d1/restore");

    fetchMock.mockResolvedValueOnce(jsonRes({ ok: true }));
    await remove("d1");
    const delCall = fetchMock.mock.calls[5] as [string, RequestInit];
    expect(delCall[0]).toBe("/api/documents/d1");
    expect(delCall[1].method).toBe("DELETE");
  });

  it("getById 走 GET 端点并缓存；trash/search/chat 端点正确", async () => {
    fetchMock.mockResolvedValueOnce(jsonRes({ id: "d1", title: "文档" }));
    expect((await getById("d1")).title).toBe("文档");
    expect(fetchMock.mock.calls[0][0]).toBe("/api/documents/d1");

    // 每次返回新 Response 对象（Response body 只能消费一次）
    fetchMock.mockImplementation(() => Promise.resolve(jsonRes([])));
    await getTrash("u1");
    expect(fetchMock.mock.calls[1][0]).toBe("/api/documents?scope=trash");
    await getSearch("u1");
    expect(fetchMock.mock.calls[2][0]).toBe("/api/documents?scope=search");

    await getChatSessions("u1");
    expect(fetchMock.mock.calls[3][0]).toBe("/api/chat/sessions");

    fetchMock.mockResolvedValueOnce(jsonRes({ id: "s1" }));
    await createChatSession("u1", "新对话");
    expect(fetchMock.mock.calls[4][0]).toBe("/api/chat/sessions");

    fetchMock.mockResolvedValueOnce(jsonRes({ ok: true }));
    await deleteChatSession("u1", "s1");
    const del = fetchMock.mock.calls[5] as [string, RequestInit];
    expect(del[0]).toBe("/api/chat/sessions/s1");
    expect(del[1].method).toBe("DELETE");

    fetchMock.mockResolvedValueOnce(jsonRes([]));
    await getChatHistory("u1", "s1", 10);
    expect(fetchMock.mock.calls[6][0]).toBe("/api/chat/sessions/s1/messages?limit=10");
  });

  it("HTTP 错误抛出服务端 error 信息", async () => {
    fetchMock.mockResolvedValueOnce(jsonRes({ error: "Unauthorized" }, false, 401));
    await expect(getSidebarAll("u1")).rejects.toThrow("Unauthorized");
  });

  it("客户端调用服务端专用函数直接抛错", async () => {
    await expect(getChatSessionSummary("u1", "s1")).rejects.toThrow("仅服务端可用");
    await expect(insertChatMessage({ userId: "u1", role: "user", content: "x" })).rejects.toThrow(
      "仅服务端可用",
    );
  });
});
