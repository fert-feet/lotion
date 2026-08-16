// /api/documents 系列路由单测（mock getDb 指向内存库，走真实 route handler）
import { describe, it, expect, beforeEach, vi } from "vitest";
import type Database from "better-sqlite3";
import { SESSION_COOKIE } from "@/lib/local/auth";
import { GET as listDocs, POST as createDoc } from "@/app/api/documents/route";
import { GET as getDoc, PATCH as patchDoc, DELETE as deleteDoc } from "@/app/api/documents/[documentId]/route";
import { PATCH as archiveDoc } from "@/app/api/documents/[documentId]/archive/route";
import { PATCH as restoreDoc } from "@/app/api/documents/[documentId]/restore/route";

const state = vi.hoisted(() => ({ db: null as Database.Database | null }));

vi.mock("@/lib/local/sqlite", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/local/sqlite")>();
  return { ...actual, getDb: () => state.db! };
});

/** 在测试库中注册用户并种会话，返回带 cookie 的请求头 */
async function authCookie(email = "a@x.com"): Promise<{ cookie: string; userId: string }> {
  const { createUser, createSession } = await import("@/lib/local/auth");
  const user = createUser(state.db!, email, "password123");
  const token = createSession(state.db!, user.id);
  return { cookie: `${SESSION_COOKIE}=${token}`, userId: user.id };
}

function req(url: string, method: string, cookie?: string, body?: unknown): Request {
  const headers = new Headers();
  if (cookie) headers.set("cookie", cookie);
  if (body !== undefined) headers.set("content-type", "application/json");
  return new Request(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

/** 动态路由 handler 的第二参数（Next 15 为 Promise<params>） */
function ctx(id: string): { params: Promise<{ documentId: string }> } {
  return { params: Promise.resolve({ documentId: id }) };
}

beforeEach(async () => {
  const { initDatabase } = await import("@/lib/local/sqlite");
  const { default: Database } = await import("better-sqlite3");
  const db = new Database(":memory:");
  initDatabase(db);
  state.db = db;
});

describe("documents API", () => {
  it("未登录访问一律 401", async () => {
    expect((await listDocs(req("http://x/api/documents", "GET"))).status).toBe(401);
    expect((await createDoc(req("http://x/api/documents", "POST", undefined, { title: "t" }))).status).toBe(401);
    expect((await getDoc(req("http://x/api/documents/1", "GET"), ctx("1"))).status).toBe(401);
  });

  it("创建文档 → 列表可见 → 单查可读", async () => {
    const { cookie, userId } = await authCookie();
    const created = await createDoc(req("http://x/api/documents", "POST", cookie, { title: "第一篇" }));
    expect(created.status).toBe(200);
    const { id } = await created.json();

    const list = await listDocs(req("http://x/api/documents?scope=sidebar", "GET", cookie));
    const docs = await list.json();
    expect(docs.map((d: { id: string }) => d.id)).toEqual([id]);

    const one = await getDoc(req(`http://x/api/documents/${id}`, "GET", cookie), ctx(id));
    expect(one.status).toBe(200);
    const doc = await one.json();
    expect(doc.title).toBe("第一篇");
    expect(doc.userId).toBe(userId);
  });

  it("scope=trash 只列已归档；scope=search 与 sidebar 一致", async () => {
    const { cookie } = await authCookie();
    const a = await (await createDoc(req("http://x", "POST", cookie, { title: "a" }))).json();
    await (await createDoc(req("http://x", "POST", cookie, { title: "b" }))).json();
    await archiveDoc(req(`http://x/api/documents/${a.id}/archive`, "PATCH", cookie), ctx(a.id));

    const trash = await (await listDocs(req("http://x/api/documents?scope=trash", "GET", cookie))).json();
    const search = await (await listDocs(req("http://x/api/documents?scope=search", "GET", cookie))).json();
    expect(trash.map((d: { id: string }) => d.id)).toEqual([a.id]);
    expect(search.map((d: { id: string }) => d.id)).toHaveLength(1);
  });

  it("PATCH 白名单：合法字段生效，isArchived/isDraft 外的越权字段被丢弃", async () => {
    const { cookie } = await authCookie();
    const { id } = await (await createDoc(req("http://x", "POST", cookie, { title: "t" }))).json();
    const res = await patchDoc(req(`http://x/api/documents/${id}`, "PATCH", cookie, {
      title: "改",
      isPublished: true,
      isArchived: true, // 不在白名单 → 丢弃
      userId: "hacked",
    }), ctx(id));
    expect(res.status).toBe(200);
    const doc = await (await getDoc(req(`http://x/api/documents/${id}`, "GET", cookie), ctx(id))).json();
    expect(doc.title).toBe("改");
    expect(doc.isPublished).toBe(true);
    expect(doc.isArchived).toBe(false);
  });

  it("跨用户单查 404（所有权隔离）", async () => {
    const a = await authCookie("a@x.com");
    const { id } = await (await createDoc(req("http://x", "POST", a.cookie, { title: "私有" }))).json();
    const b = await authCookie("b@x.com");
    expect((await getDoc(req(`http://x/api/documents/${id}`, "GET", b.cookie), ctx(id))).status).toBe(404);
  });

  it("archive/restore 递归语义经 API 生效", async () => {
    const { cookie } = await authCookie();
    const parent = await (await createDoc(req("http://x", "POST", cookie, { title: "p" }))).json();
    const child = await (
      await createDoc(req("http://x", "POST", cookie, { title: "c", parentDocument: parent.id }))
    ).json();

    await archiveDoc(req(`http://x/api/documents/${parent.id}/archive`, "PATCH", cookie), ctx(parent.id));
    const archived = await (await getDoc(req(`http://x/api/documents/${child.id}`, "GET", cookie), ctx(child.id))).json();
    expect(archived.isArchived).toBe(true);

    await restoreDoc(req(`http://x/api/documents/${child.id}/restore`, "PATCH", cookie), ctx(child.id));
    const restored = await (await getDoc(req(`http://x/api/documents/${child.id}`, "GET", cookie), ctx(child.id))).json();
    expect(restored.isArchived).toBe(false);
    expect(restored.parentDocument).toBeNull(); // parent 仍归档 → detach
  });

  it("DELETE 删除文档", async () => {
    const { cookie } = await authCookie();
    const { id } = await (await createDoc(req("http://x", "POST", cookie, { title: "t" }))).json();
    expect((await deleteDoc(req(`http://x/api/documents/${id}`, "DELETE", cookie), ctx(id))).status).toBe(200);
    expect((await getDoc(req(`http://x/api/documents/${id}`, "GET", cookie), ctx(id))).status).toBe(404);
  });

  it("POST 缺 title 返回 400", async () => {
    const { cookie } = await authCookie();
    expect((await createDoc(req("http://x", "POST", cookie, {}))).status).toBe(400);
  });
});
