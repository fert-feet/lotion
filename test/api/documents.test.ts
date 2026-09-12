// /api/documents 系列路由单测（mock getDb 指向内存库，经 Hono app.request 走真实路由）
import { describe, it, expect, beforeEach, vi } from "vitest";
import type Database from "better-sqlite3";
import { SESSION_COOKIE } from "@/lib/local/auth";
import { createApiTestApp } from "../mocks/api-app";

const state = vi.hoisted(() => ({ db: null as Database.Database | null }));

vi.mock("@/lib/local/sqlite", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/local/sqlite")>();
  return { ...actual, getDb: () => state.db! };
});

let app: Awaited<ReturnType<typeof createApiTestApp>>["app"];

/** 在测试库中注册用户并种会话，返回带 cookie 的请求头 */
async function authCookie(email = "a@x.com"): Promise<{ cookie: string; userId: string }> {
  const { createUser, createSession } = await import("@/lib/local/auth");
  const user = createUser(state.db!, email, "password123");
  const token = createSession(state.db!, user.id);
  return { cookie: `${SESSION_COOKIE}=${token}`, userId: user.id };
}

/** 调用 API（path 已含 /api 前缀） */
function call(path: string, method: string, cookie?: string, body?: unknown) {
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) headers["content-type"] = "application/json";
  return app.request(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(async () => {
  const { initDatabase } = await import("@/lib/local/sqlite");
  const { default: Database } = await import("better-sqlite3");
  const db = new Database(":memory:");
  initDatabase(db);
  state.db = db;

  ({ app } = await createApiTestApp());
});

describe("documents API", () => {
  it("未登录访问一律 401", async () => {
    expect((await call("/api/documents", "GET")).status).toBe(401);
    expect((await call("/api/documents", "POST", undefined, { title: "t" })).status).toBe(401);
    expect((await call("/api/documents/1", "GET")).status).toBe(401);
  });

  it("创建文档 → 列表可见 → 单查可读", async () => {
    const { cookie, userId } = await authCookie();
    const created = await call("/api/documents", "POST", cookie, { title: "第一篇" });
    expect(created.status).toBe(200);
    const { id } = await created.json();

    const list = await call("/api/documents?scope=sidebar", "GET", cookie);
    const docs = await list.json();
    expect(docs.map((d: { id: string }) => d.id)).toEqual([id]);

    const one = await call(`/api/documents/${id}`, "GET", cookie);
    expect(one.status).toBe(200);
    const doc = await one.json();
    expect(doc.title).toBe("第一篇");
    expect(doc.userId).toBe(userId);
  });

  it("scope=trash 只列已归档；scope=search 与 sidebar 一致", async () => {
    const { cookie } = await authCookie();
    const a = await (await call("/api/documents", "POST", cookie, { title: "a" })).json();
    await (await call("/api/documents", "POST", cookie, { title: "b" })).json();
    await call(`/api/documents/${a.id}/archive`, "PATCH", cookie);

    const trash = await (await call("/api/documents?scope=trash", "GET", cookie)).json();
    const search = await (await call("/api/documents?scope=search", "GET", cookie)).json();
    expect(trash.map((d: { id: string }) => d.id)).toEqual([a.id]);
    expect(search.map((d: { id: string }) => d.id)).toHaveLength(1);
  });

  it("PATCH 白名单：合法字段生效，isArchived/isDraft 外的越权字段被丢弃", async () => {
    const { cookie } = await authCookie();
    const { id } = await (await call("/api/documents", "POST", cookie, { title: "t" })).json();
    const res = await call(`/api/documents/${id}`, "PATCH", cookie, {
      title: "改",
      isPublished: true,
      isArchived: true, // 不在白名单 → 丢弃
      userId: "hacked",
    });
    expect(res.status).toBe(200);
    const doc = await (await call(`/api/documents/${id}`, "GET", cookie)).json();
    expect(doc.title).toBe("改");
    expect(doc.isPublished).toBe(true);
    expect(doc.isArchived).toBe(false);
  });

  it("跨用户单查 404（所有权隔离）", async () => {
    const a = await authCookie("a@x.com");
    const { id } = await (await call("/api/documents", "POST", a.cookie, { title: "私有" })).json();
    const b = await authCookie("b@x.com");
    expect((await call(`/api/documents/${id}`, "GET", b.cookie)).status).toBe(404);
  });

  it("archive/restore 递归语义经 API 生效", async () => {
    const { cookie } = await authCookie();
    const parent = await (await call("/api/documents", "POST", cookie, { title: "p" })).json();
    const child = await (
      await call("/api/documents", "POST", cookie, { title: "c", parentDocument: parent.id })
    ).json();

    await call(`/api/documents/${parent.id}/archive`, "PATCH", cookie);
    const archived = await (await call(`/api/documents/${child.id}`, "GET", cookie)).json();
    expect(archived.isArchived).toBe(true);

    await call(`/api/documents/${child.id}/restore`, "PATCH", cookie);
    const restored = await (await call(`/api/documents/${child.id}`, "GET", cookie)).json();
    expect(restored.isArchived).toBe(false);
    expect(restored.parentDocument).toBeNull(); // parent 仍归档 → detach
  });

  it("DELETE 删除文档", async () => {
    const { cookie } = await authCookie();
    const { id } = await (await call("/api/documents", "POST", cookie, { title: "t" })).json();
    expect((await call(`/api/documents/${id}`, "DELETE", cookie)).status).toBe(200);
    expect((await call(`/api/documents/${id}`, "GET", cookie)).status).toBe(404);
  });

  it("POST 缺 title 返回 400", async () => {
    const { cookie } = await authCookie();
    expect((await call("/api/documents", "POST", cookie, {})).status).toBe(400);
  });

  it("PUT move 移动文档：移到根目录 / 移到指定父文档 / 防循环 / 权限隔离", async () => {
    const { cookie, userId } = await authCookie();
    const a = await (await call("/api/documents", "POST", cookie, { title: "a" })).json();
    const b = await (await call("/api/documents", "POST", cookie, { title: "b" })).json();
    const c = await (
      await call("/api/documents", "POST", cookie, { title: "c", parentDocument: b.id })
    ).json();

    // 移动到指定父文档
    const moved = await call(`/api/documents/${a.id}/move`, "PUT", cookie, { parentDocument: b.id });
    expect(moved.status).toBe(200);
    expect(((await moved.json()) as { parentDocument: string }).parentDocument).toBe(b.id);

    // 防循环：b（父）不能移动到 c（子）下
    const cycle = await call(`/api/documents/${b.id}/move`, "PUT", cookie, { parentDocument: c.id });
    expect(cycle.status).toBe(400);

    // 移到根目录（null）
    const toRoot = await call(`/api/documents/${a.id}/move`, "PUT", cookie, { parentDocument: null });
    expect(toRoot.status).toBe(200);
    const docA = await (await call(`/api/documents/${a.id}`, "GET", cookie)).json();
    expect(docA.parentDocument).toBeNull();

    // 跨用户：他人文档 404
    const other = await authCookie("other@x.com");
    const foreign = await call(`/api/documents/${b.id}/move`, "PUT", other.cookie, {
      parentDocument: null,
    });
    expect(foreign.status).toBe(404);

    // 未登录 401
    expect((await call(`/api/documents/${b.id}/move`, "PUT")).status).toBe(401);
    expect(userId.length).toBeGreaterThan(0);
  });

  it("PUT move 目标父文档不存在/已归档时返回 400", async () => {
    const { cookie } = await authCookie();
    const a = await (await call("/api/documents", "POST", cookie, { title: "a" })).json();

    const missing = await call(`/api/documents/${a.id}/move`, "PUT", cookie, {
      parentDocument: "no-such-id",
    });
    expect(missing.status).toBe(400);

    const archived = await (await call("/api/documents", "POST", cookie, { title: "arch" })).json();
    await call(`/api/documents/${archived.id}/archive`, "PATCH", cookie);
    const toArchived = await call(`/api/documents/${a.id}/move`, "PUT", cookie, {
      parentDocument: archived.id,
    });
    expect(toArchived.status).toBe(400);
  });
});
