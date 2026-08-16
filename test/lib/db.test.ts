// lib/db.ts（客户端数据入口）单测：全部走 fetch REST，
// 验证 URL/方法/请求体/错误处理与缓存行为。
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  getSidebarAll,
  getTrash,
  getSearch,
  getById,
  getByIdFresh,
  getPublishedDocument,
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
  _resetDocCacheForTest,
} from "@/lib/db";

const fetchMock = vi.fn();

function jsonRes(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  _resetDocCacheForTest();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("lib/db 客户端入口（fetch REST）", () => {
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

    fetchMock.mockResolvedValueOnce(jsonRes({ ok: true }));
    await removeIcon("d1");
    expect(JSON.parse((fetchMock.mock.calls[6][1] as RequestInit).body as string)).toEqual({ icon: null });

    fetchMock.mockResolvedValueOnce(jsonRes({ ok: true }));
    await removeCoverImage("d1");
    expect(JSON.parse((fetchMock.mock.calls[7][1] as RequestInit).body as string)).toEqual({ coverImage: null });
  });

  it("getById 走 GET 端点并缓存；getByIdFresh 绕过缓存", async () => {
    fetchMock.mockResolvedValueOnce(jsonRes({ id: "d1", title: "文档" }));
    expect((await getById("d1")).title).toBe("文档");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // 命中缓存：不再发请求
    await getById("d1");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // 绕过缓存：重新请求
    fetchMock.mockResolvedValueOnce(jsonRes({ id: "d1", title: "新标题" }));
    expect((await getByIdFresh("d1")).title).toBe("新标题");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("trash/search/chat/公开预览端点正确", async () => {
    // 每次返回新 Response 对象（Response body 只能消费一次）
    fetchMock.mockImplementation(() => Promise.resolve(jsonRes([])));

    await getTrash("u1");
    expect(fetchMock.mock.calls[0][0]).toBe("/api/documents?scope=trash");
    await getSearch("u1");
    expect(fetchMock.mock.calls[1][0]).toBe("/api/documents?scope=search");

    await getChatSessions("u1");
    expect(fetchMock.mock.calls[2][0]).toBe("/api/chat/sessions");

    fetchMock.mockResolvedValueOnce(jsonRes({ id: "s1" }));
    await createChatSession("u1", "新对话");
    expect(fetchMock.mock.calls[3][0]).toBe("/api/chat/sessions");

    fetchMock.mockResolvedValueOnce(jsonRes({ ok: true }));
    await deleteChatSession("u1", "s1");
    const del = fetchMock.mock.calls[4] as [string, RequestInit];
    expect(del[0]).toBe("/api/chat/sessions/s1");
    expect(del[1].method).toBe("DELETE");

    fetchMock.mockResolvedValueOnce(jsonRes([]));
    await getChatHistory("u1", "s1", 10);
    expect(fetchMock.mock.calls[5][0]).toBe("/api/chat/sessions/s1/messages?limit=10");

    fetchMock.mockResolvedValueOnce(jsonRes({ id: "d1", isPublished: true }));
    await getPublishedDocument("d1");
    expect(fetchMock.mock.calls[6][0]).toBe("/api/public/documents/d1");
  });

  it("HTTP 错误抛出服务端 error 信息", async () => {
    fetchMock.mockResolvedValueOnce(jsonRes({ error: "Unauthorized" }, 401));
    await expect(getSidebarAll("u1")).rejects.toThrow("Unauthorized");
  });

  it("非 JSON 错误响应回退为状态码信息", async () => {
    fetchMock.mockResolvedValueOnce(new Response("oops", { status: 500 }));
    await expect(getSidebarAll("u1")).rejects.toThrow("请求失败（500）");
  });
});
