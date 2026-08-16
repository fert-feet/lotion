// /api/chat/sessions 系列路由单测（mock getDb 指向内存库，走真实 route handler）
import { describe, it, expect, beforeEach, vi } from "vitest";
import type Database from "better-sqlite3";
import { SESSION_COOKIE } from "@/lib/local/auth";
import { GET as listSessions, POST as createSession } from "@/app/api/chat/sessions/route";
import { DELETE as deleteSession } from "@/app/api/chat/sessions/[sessionId]/route";
import { GET as listMessages } from "@/app/api/chat/sessions/[sessionId]/messages/route";

const state = vi.hoisted(() => ({ db: null as Database.Database | null }));

vi.mock("@/lib/local/sqlite", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/local/sqlite")>();
  return { ...actual, getDb: () => state.db! };
});

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
function ctx(id: string): { params: Promise<{ sessionId: string }> } {
  return { params: Promise.resolve({ sessionId: id }) };
}

beforeEach(async () => {
  const { initDatabase } = await import("@/lib/local/sqlite");
  const { default: Database } = await import("better-sqlite3");
  const db = new Database(":memory:");
  initDatabase(db);
  state.db = db;
});

describe("chat sessions API", () => {
  it("未登录访问一律 401", async () => {
    expect((await listSessions(req("http://x/api/chat/sessions", "GET"))).status).toBe(401);
    expect((await createSession(req("http://x/api/chat/sessions", "POST", undefined, {}))).status).toBe(401);
  });

  it("创建会话（默认标题/自定义标题）→ 列表按更新时间倒序", async () => {
    const { cookie } = await authCookie();
    const s1 = await (await createSession(req("http://x", "POST", cookie, {}))).json();
    const s2 = await (await createSession(req("http://x", "POST", cookie, { title: "自定义" }))).json();

    const sessions = await (await listSessions(req("http://x", "GET", cookie))).json();
    expect(sessions.map((s: { id: string }) => s.id)).toEqual([s2.id, s1.id]);
    expect(sessions[0].title).toBe("自定义");
  });

  it("会话隔离：他人会话不可见、不可删", async () => {
    const a = await authCookie("a@x.com");
    const { id } = await (await createSession(req("http://x", "POST", a.cookie, {}))).json();
    const b = await authCookie("b@x.com");
    expect(await (await listSessions(req("http://x", "GET", b.cookie))).json()).toEqual([]);
    await deleteSession(req(`http://x/api/chat/sessions/${id}`, "DELETE", b.cookie), ctx(id));
    // a 的会话仍存在
    expect((await listSessions(req("http://x", "GET", a.cookie)).then((r) => r.json()))).toHaveLength(1);
  });

  it("历史消息：升序返回、limit 生效、删除会话后为空", async () => {
    const { cookie, userId } = await authCookie();
    const { id } = await (await createSession(req("http://x", "POST", cookie, {}))).json();

    const { insertChatMessage } = await import("@/lib/local/db");
    insertChatMessage(state.db!, { userId, sessionId: id, role: "user", content: "q1" });
    insertChatMessage(state.db!, { userId, sessionId: id, role: "assistant", content: "a1" });

    const messages = await (
      await listMessages(req(`http://x/api/chat/sessions/${id}/messages`, "GET", cookie), ctx(id))
    ).json();
    expect(messages.map((m: { content: string }) => m.content)).toEqual(["q1", "a1"]);

    const limited = await (
      await listMessages(req(`http://x/api/chat/sessions/${id}/messages?limit=1`, "GET", cookie), ctx(id))
    ).json();
    expect(limited).toHaveLength(1);

    await deleteSession(req(`http://x/api/chat/sessions/${id}`, "DELETE", cookie), ctx(id));
    expect(
      await (await listMessages(req(`http://x/api/chat/sessions/${id}/messages`, "GET", cookie), ctx(id))).json(),
    ).toEqual([]);
  });
});
