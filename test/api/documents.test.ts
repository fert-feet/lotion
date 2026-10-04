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
  it("POST append 把 Markdown 追加到文档末尾（转成 BlockNote JSON）", async () => {
    const { cookie } = await authCookie();
    const doc = await (await call("/api/documents", "POST", cookie, { title: "目标" })).json();
    await call(`/api/documents/${doc.id}`, "PATCH", cookie, { content: "原有内容" });

    const res = await call(`/api/documents/${doc.id}/append`, "POST", cookie, {
      markdown: "## 追加标题\n\n- 条目一",
    });
    expect(res.status).toBe(200);

    const row = state.db!
      .prepare("SELECT content FROM documents WHERE id = ?")
      .get(doc.id) as { content: string };
    const blocks = JSON.parse(row.content) as Array<{ type: string; content?: unknown }>;
    expect(Array.isArray(blocks)).toBe(true);
    expect(blocks.length).toBeGreaterThan(1);
    // 原文与追加内容都在（追加不覆盖）
    expect(row.content).toContain("原有内容");
    expect(row.content).toContain("追加标题");
  });

  it("POST append 参数与权限校验（空内容 400 / 超长 413 / 他人文档 404 / 未登录 401）", async () => {
    const { cookie } = await authCookie();
    const doc = await (await call("/api/documents", "POST", cookie, { title: "目标" })).json();

    expect((await call(`/api/documents/${doc.id}/append`, "POST", cookie, { markdown: "  " })).status).toBe(400);
    expect(
      (await call(`/api/documents/${doc.id}/append`, "POST", cookie, { markdown: "x".repeat(20_001) })).status,
    ).toBe(413);
    expect((await call(`/api/documents/${doc.id}/append`, "POST", cookie, {})).status).toBe(400);
    expect((await call(`/api/documents/${doc.id}/append`, "POST")).status).toBe(401);

    const other = await authCookie("append-other@x.com");
    expect(
      (await call(`/api/documents/${doc.id}/append`, "POST", other.cookie, { markdown: "hi" })).status,
    ).toBe(404);
  });

  it("POST append 到已归档文档返回 400（先恢复再插入）", async () => {
    const { cookie } = await authCookie();
    const doc = await (await call("/api/documents", "POST", cookie, { title: "归档的" })).json();
    await call(`/api/documents/${doc.id}/archive`, "PATCH", cookie);

    const res = await call(`/api/documents/${doc.id}/append`, "POST", cookie, { markdown: "hi" });
    expect(res.status).toBe(400);
  });
});

// 回归：PATCH / DELETE /:documentId 曾经既不读 c.get("user") 也不做归属校验，
// 底层 SQL 也只有 WHERE id = ? —— 任何登录用户拿到文档 id 就能改/删他人文档。
describe("documents API —— 归属隔离（PATCH/DELETE 横向越权回归）", () => {
  /** 造一个 owner 的文档，返回 id 与 owner 凭据 */
  async function seedOwnedDoc(title = "属于 owner") {
    const owner = await authCookie("owner@x.com");
    const doc = await (await call("/api/documents", "POST", owner.cookie, { title })).json();
    return { owner, docId: doc.id as string };
  }

  it("PATCH 他人文档返回 404，且不改动对方数据", async () => {
    const { owner, docId } = await seedOwnedDoc();
    const attacker = await authCookie("attacker@x.com");

    const res = await call(`/api/documents/${docId}`, "PATCH", attacker.cookie, {
      title: "被篡改",
      content: "被篡改",
    });
    expect(res.status).toBe(404);

    const { getDocumentById } = await import("@/lib/local/db");
    expect(getDocumentById(state.db!, docId, owner.userId)!.title).toBe("属于 owner");
  });

  it("DELETE 他人文档返回 404，且文档仍然存在", async () => {
    const { owner, docId } = await seedOwnedDoc();
    const attacker = await authCookie("attacker@x.com");

    expect((await call(`/api/documents/${docId}`, "DELETE", attacker.cookie)).status).toBe(404);

    const { getDocumentById } = await import("@/lib/local/db");
    expect(getDocumentById(state.db!, docId, owner.userId)).not.toBeNull();
  });

  it("PATCH/DELETE 不存在的 id 一律 404（不再无条件 ok）", async () => {
    const { cookie } = await authCookie();
    expect((await call("/api/documents/does-not-exist", "PATCH", cookie, { title: "x" })).status).toBe(404);
    expect((await call("/api/documents/does-not-exist", "DELETE", cookie)).status).toBe(404);
  });

  it("未登录 PATCH/DELETE 仍是 401（鉴权先于归属）", async () => {
    const { docId } = await seedOwnedDoc();
    expect((await call(`/api/documents/${docId}`, "PATCH", undefined, { title: "x" })).status).toBe(401);
    expect((await call(`/api/documents/${docId}`, "DELETE")).status).toBe(401);
  });

  it("本人 PATCH/DELETE 照常生效（阳性对照）", async () => {
    const { owner, docId } = await seedOwnedDoc();

    expect((await call(`/api/documents/${docId}`, "PATCH", owner.cookie, { title: "改过了" })).status).toBe(200);
    const { getDocumentById } = await import("@/lib/local/db");
    expect(getDocumentById(state.db!, docId, owner.userId)!.title).toBe("改过了");

    expect((await call(`/api/documents/${docId}`, "DELETE", owner.cookie)).status).toBe(200);
    expect(getDocumentById(state.db!, docId, owner.userId)).toBeNull();
  });
});
