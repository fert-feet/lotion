// docStore 浏览器侧实现单测：契约方法 → REST 端点映射（含 listOverview 的本地派生）。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRestDocStore, restDocStorePlugin } from "@/lib/client/doc-store-rest";
import {createRootContext } from "@/lib/kernel";
import { mount } from "@/test/mocks/mount";
import { findUiDocStore, requireUiDocStore } from "@/lib/seams/doc-store";
import { _resetDocCacheForTest } from "@/lib/db";

const fetchMock = vi.fn();
const actor = { userId: "u1" };

function jsonRes(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** 取最近一次 fetch 的 [path, init] */
function lastCall(): [string, RequestInit | undefined] {
  const call = fetchMock.mock.calls.at(-1);
  return [call?.[0] as string, call?.[1] as RequestInit | undefined];
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  _resetDocCacheForTest();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("lib/client/doc-store-rest 文档操作", () => {
  it("列表类方法打到对应 scope 端点", async () => {
    const store = createRestDocStore();
    fetchMock.mockImplementation(async () => jsonRes([]));

    await store.listSidebarAll(actor);
    expect(lastCall()[0]).toBe("/api/documents?scope=sidebar");

    await store.listTrash(actor);
    expect(lastCall()[0]).toBe("/api/documents?scope=trash");

    await store.listSearch(actor);
    expect(lastCall()[0]).toBe("/api/documents?scope=search");
  });

  it("getById 默认走缓存端点，fresh 时强制刷新", async () => {
    const store = createRestDocStore();
    const doc = { id: "d1", title: "标题" };
    fetchMock.mockImplementation(async () => jsonRes(doc));

    await store.getById(actor, "d1");
    expect(lastCall()[0]).toBe("/api/documents/d1");

    // 第二次默认命中缓存：不再发请求
    fetchMock.mockClear();
    await store.getById(actor, "d1");
    expect(fetchMock).not.toHaveBeenCalled();

    await store.getById(actor, "d1", { fresh: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("写入类方法用正确的 HTTP 方法与端点", async () => {
    const store = createRestDocStore();

    fetchMock.mockImplementation(async () => jsonRes({ id: "new" }));
    await store.create(actor, "新文档", null);
    expect(lastCall()).toEqual([
      "/api/documents",
      expect.objectContaining({ method: "POST" }),
    ]);

    fetchMock.mockImplementation(async () => jsonRes({ ok: true }));
    await store.update(actor, "d1", { title: "改名" });
    expect(lastCall()).toEqual(["/api/documents/d1", expect.objectContaining({ method: "PATCH" })]);

    await store.archive(actor, "d1");
    expect(lastCall()).toEqual([
      "/api/documents/d1/archive",
      expect.objectContaining({ method: "PATCH" }),
    ]);

    await store.restore(actor, "d1");
    expect(lastCall()).toEqual([
      "/api/documents/d1/restore",
      expect.objectContaining({ method: "PATCH" }),
    ]);

    await store.move(actor, "d1", "p1");
    expect(lastCall()).toEqual(["/api/documents/d1/move", expect.objectContaining({ method: "PUT" })]);

    await store.remove(actor, "d1");
    expect(lastCall()).toEqual(["/api/documents/d1", expect.objectContaining({ method: "DELETE" })]);
  });

  it("listOverview 由全量列表派生 childCount（浏览器没有 overview 端点）", async () => {
    const store = createRestDocStore();
    fetchMock.mockResolvedValue(
      jsonRes([
        { id: "p1", title: "父", parentDocument: null, updatedAt: "2026-01-01" },
        { id: "c1", title: "子1", parentDocument: "p1", updatedAt: "2026-01-02" },
        { id: "c2", title: "子2", parentDocument: "p1", updatedAt: "2026-01-03" },
        { id: "r2", title: "另一个根", parentDocument: null, updatedAt: "2026-01-04" },
      ]),
    );

    const overview = await store.listOverview(actor, null);

    expect(overview.map((item) => [item.id, item.childCount])).toEqual([
      ["p1", 2],
      ["r2", 0],
    ]);
  });
});

describe("lib/client/doc-store-rest 会话操作", () => {
  it("会话列表/创建/删除/历史映射到 /api/chat/sessions", async () => {
    const store = createRestDocStore();

    fetchMock.mockImplementation(async () => jsonRes([]));
    await store.listChatSessions(actor);
    expect(lastCall()[0]).toBe("/api/chat/sessions");

    fetchMock.mockImplementation(async () => jsonRes({ id: "s1" }));
    await store.createChatSession(actor, "新对话");
    expect(lastCall()).toEqual(["/api/chat/sessions", expect.objectContaining({ method: "POST" })]);

    fetchMock.mockImplementation(async () => jsonRes([]));
    await store.listChatHistory(actor, "s1", 10);
    expect(lastCall()[0]).toBe("/api/chat/sessions/s1/messages?limit=10");

    // 重命名会话（UI 功能，走 PATCH）
    fetchMock.mockImplementation(async () => jsonRes({ ok: true }));
    await store.setChatSessionTitle(actor, "s1", "新标题");
    expect(lastCall()).toEqual([
      "/api/chat/sessions/s1",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ title: "新标题" }) }),
    ]);

    // 撤销 AI 改动（回合操作条）
    fetchMock.mockImplementation(async () => jsonRes({ ok: true, restored: ["d1"], skipped: 0 }));
    await store.undoAiChanges(actor, "req-1");
    expect(lastCall()).toEqual([
      "/api/ai/undo",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ requestId: "req-1" }) }),
    ]);

    // 改动预览（回合操作条）
    fetchMock.mockImplementation(async () => jsonRes({ changes: [{ documentId: "d1", before: "a", after: "b" }] }));
    const preview = await store.previewAiChanges(actor, "req-1");
    expect(lastCall()[0]).toBe("/api/ai/undo/req-1/preview");
    expect(preview).toHaveLength(1);

    fetchMock.mockImplementation(async () => jsonRes({ ok: true }));
    await store.deleteChatSession(actor, "s1");
    expect(lastCall()).toEqual([
      "/api/chat/sessions/s1",
      expect.objectContaining({ method: "DELETE" }),
    ]);
  });
});

describe("lib/client/doc-store-rest 装配", () => {
  it("插件挂载后可按 UI 子集读取，卸载后消失", async () => {
    const ctx = createRootContext();
    const fiber = await mount(ctx, restDocStorePlugin);

    expect(requireUiDocStore(ctx)).toBeDefined();
    expect(findUiDocStore(ctx)).toBeDefined();

    await fiber.dispose();
    expect(findUiDocStore(ctx)).toBeUndefined();
  });

  it("UI 子集不含宿主独有的写操作（浏览器不假装能做）", async () => {
    const store = createRestDocStore() as unknown as Record<string, unknown>;

    expect(store.insertChatMessage).toBeUndefined();
    expect(store.touchChatSession).toBeUndefined();
    // 重命名会话是 UI 功能（浏览器经 PATCH /api/chat/sessions/:id 实现），不在宿主独有之列
    expect(typeof store.setChatSessionTitle).toBe("function");
  });
});
