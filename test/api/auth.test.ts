// Auth API 路由单测：mock getDb 指向内存库，走真实 route handler
// （覆盖 register/login/logout/me 的完整 cookie 会话流）
import { describe, it, expect, beforeEach, vi } from "vitest";
import type Database from "better-sqlite3";
import { SESSION_COOKIE } from "@/lib/local/auth";
import { POST as register } from "@/app/api/auth/register/route";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { GET as me } from "@/app/api/me/route";

const state = vi.hoisted(() => ({ db: null as Database.Database | null }));

// getDb 替换为测试内存库（每例 beforeEach 重置）
vi.mock("@/lib/local/sqlite", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/local/sqlite")>();
  return { ...actual, getDb: () => state.db! };
});

function jsonRequest(url: string, body: unknown, cookie?: string): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (cookie) headers.set("cookie", cookie);
  return new Request(url, { method: "POST", headers, body: JSON.stringify(body) });
}

beforeEach(async () => {
  const { initDatabase } = await import("@/lib/local/sqlite");
  const { default: Database } = await import("better-sqlite3");
  const db = new Database(":memory:");
  initDatabase(db);
  state.db = db;
});

describe("auth API", () => {
  it("注册 → 返回用户并种会话 cookie → /api/me 可读", async () => {
    const res = await register(jsonRequest("http://x/api/auth/register", {
      email: "new@x.com",
      password: "password123",
      name: "New",
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.email).toBe("new@x.com");

    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`${SESSION_COOKIE}=`);
    expect(setCookie).toContain("HttpOnly");
    const token = setCookie.split(";")[0].split("=")[1];

    const meRes = await me(new Request("http://x/api/me", {
      headers: { cookie: `${SESSION_COOKIE}=${token}` },
    }));
    expect(meRes.status).toBe(200);
    expect((await meRes.json()).user.id).toBe(body.user.id);
  });

  it("注册校验：非法邮箱 / 短密码 400，重复邮箱 409", async () => {
    expect((await register(jsonRequest("http://x", { email: "bad", password: "password123" }))).status).toBe(400);
    expect((await register(jsonRequest("http://x", { email: "a@x.com", password: "short" }))).status).toBe(400);

    await register(jsonRequest("http://x", { email: "dup@x.com", password: "password123" }));
    const dup = await register(jsonRequest("http://x", { email: "DUP@x.com", password: "password123" }));
    expect(dup.status).toBe(409);
    expect((await dup.json()).code).toBe("EMAIL_EXISTS");
  });

  it("登录：成功种 cookie；错误密码/未知邮箱 401", async () => {
    await register(jsonRequest("http://x", { email: "u@x.com", password: "password123" }));

    const ok = await login(jsonRequest("http://x", { email: "u@x.com", password: "password123" }));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("set-cookie")).toContain(`${SESSION_COOKIE}=`);

    const badPass = await login(jsonRequest("http://x", { email: "u@x.com", password: "wrong" }));
    expect(badPass.status).toBe(401);

    const ghost = await login(jsonRequest("http://x", { email: "ghost@x.com", password: "password123" }));
    expect(ghost.status).toBe(401);
  });

  it("注销：清除 cookie 且会话立即失效", async () => {
    const reg = await register(jsonRequest("http://x", { email: "o@x.com", password: "password123" }));
    const token = reg.headers.get("set-cookie")!.split(";")[0].split("=")[1];

    const out = await logout(new Request("http://x/api/auth/logout", {
      method: "POST",
      headers: { cookie: `${SESSION_COOKIE}=${token}` },
    }));
    expect(out.status).toBe(200);
    expect(out.headers.get("set-cookie")).toContain(`${SESSION_COOKIE}=;`);

    const meRes = await me(new Request("http://x/api/me", {
      headers: { cookie: `${SESSION_COOKIE}=${token}` },
    }));
    expect(meRes.status).toBe(401);
  });

  it("/api/me 无 cookie 返回 401", async () => {
    const res = await me(new Request("http://x/api/me"));
    expect(res.status).toBe(401);
    expect((await res.json()).user).toBeNull();
  });

  it("非 JSON 请求体返回 400 而非 500", async () => {
    const res = await register(
      new Request("http://x", { method: "POST", body: "not-json" }),
    );
    expect(res.status).toBe(400);
  });
});
