// /api/chat/sessions 系列路由单测（mock getDb 指向内存库，经 Hono app.request 走真实路由）
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

describe("chat sessions API", () => {
  it("未登录访问一律 401", async () => {
    expect((await call("/api/chat/sessions", "GET")).status).toBe(401);
    expect((await call("/api/chat/sessions", "POST", undefined, {})).status).toBe(401);
  });

  it("创建会话（默认标题/自定义标题）→ 列表按更新时间倒序", async () => {
    const { cookie } = await authCookie();
    const s1 = await (await call("/api/chat/sessions", "POST", cookie, {})).json();
    const s2 = await (await call("/api/chat/sessions", "POST", cookie, { title: "自定义" })).json();

    const sessions = await (await call("/api/chat/sessions", "GET", cookie)).json();
    expect(sessions.map((s: { id: string }) => s.id)).toEqual([s2.id, s1.id]);
    expect(sessions[0].title).toBe("自定义");
  });

  it("会话隔离：他人会话不可见、不可删", async () => {
    const a = await authCookie("a@x.com");
    const { id } = await (await call("/api/chat/sessions", "POST", a.cookie, {})).json();
    const b = await authCookie("b@x.com");
    expect(await (await call("/api/chat/sessions", "GET", b.cookie)).json()).toEqual([]);
    await call(`/api/chat/sessions/${id}`, "DELETE", b.cookie);
    // a 的会话仍存在
    expect(await (await call("/api/chat/sessions", "GET", a.cookie)).json()).toHaveLength(1);
  });

  it("历史消息：升序返回、limit 生效、删除会话后为空", async () => {
    const { cookie, userId } = await authCookie();
    const { id } = await (await call("/api/chat/sessions", "POST", cookie, {})).json();

    const { insertChatMessage } = await import("@/lib/local/db");
    insertChatMessage(state.db!, { userId, sessionId: id, role: "user", content: "q1" });
    insertChatMessage(state.db!, { userId, sessionId: id, role: "assistant", content: "a1" });

    const messages = await (
      await call(`/api/chat/sessions/${id}/messages`, "GET", cookie)
    ).json();
    expect(messages.map((m: { content: string }) => m.content)).toEqual(["q1", "a1"]);

    const limited = await (
      await call(`/api/chat/sessions/${id}/messages?limit=1`, "GET", cookie)
    ).json();
    expect(limited).toHaveLength(1);

    await call(`/api/chat/sessions/${id}`, "DELETE", cookie);
    expect(await (await call(`/api/chat/sessions/${id}/messages`, "GET", cookie)).json()).toEqual([]);
  });
});

/** 建一个用户 + 一个会话（会话归属该用户） */
async function seedSession(): Promise<{ cookie: string; userId: string; sessionId: string }> {
  const { cookie, userId } = await authCookie();
  const { createChatSession } = await import("@/lib/local/db");
  const sessionId = createChatSession(state.db!, userId);
  return { cookie, userId, sessionId };
}

describe("PATCH /api/chat/sessions/:id 重命名", () => {
  it("重命名成功并落库；空标题 400、超长 400、不存在 404、未登录 401", async () => {
    const { cookie, sessionId } = await seedSession();
    const ok = await call(`/api/chat/sessions/${sessionId}`, "PATCH", cookie, { title: "新标题" });
    expect(ok.status).toBe(200);
    const row = state.db!.prepare("SELECT title FROM chat_sessions WHERE id = ?").get(sessionId) as {
      title: string;
    };
    expect(row.title).toBe("新标题");

    expect((await call(`/api/chat/sessions/${sessionId}`, "PATCH", cookie, { title: "  " })).status).toBe(400);
    expect(
      (await call(`/api/chat/sessions/${sessionId}`, "PATCH", cookie, { title: "x".repeat(61) })).status,
    ).toBe(400);
    expect((await call("/api/chat/sessions/ghost", "PATCH", cookie, { title: "x" })).status).toBe(404);
    expect((await call(`/api/chat/sessions/${sessionId}`, "PATCH", undefined, { title: "x" })).status).toBe(401);
  });
});
