// Auth API 单测：mock getDb 指向内存库，经 Hono app.request 走真实路由
// （覆盖 register/login/logout/me 的完整 cookie 会话流）
// 迁移自直连 Next.js Route Handler 的写法——Hono 的 app.request 无需监听端口。
import { describe, it, expect, beforeEach, vi } from "vitest";
import type Database from "better-sqlite3";
import { SESSION_COOKIE } from "@/lib/local/auth";
import { createApiTestApp } from "../mocks/api-app";

const state = vi.hoisted(() => ({ db: null as Database.Database | null }));

// getDb 替换为测试内存库（每例 beforeEach 重置）
vi.mock("@/lib/local/sqlite", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/local/sqlite")>();
  return { ...actual, getDb: () => state.db! };
});

let app: Awaited<ReturnType<typeof createApiTestApp>>["app"];

/** POST JSON 请求（cookie 可选） */
function post(path: string, body?: unknown, cookie?: string) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (cookie) headers.cookie = cookie;
  return app.request(path, {
    method: "POST",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** 从 set-cookie 提取会话 token */
function tokenOf(res: Response): string {
  return (res.headers.get("set-cookie") ?? "").split(";")[0].split("=")[1];
}

beforeEach(async () => {
  const { initDatabase } = await import("@/lib/local/sqlite");
  const { default: Database } = await import("better-sqlite3");
  const db = new Database(":memory:");
  initDatabase(db);
  state.db = db;

  ({ app } = await createApiTestApp());
});

describe("auth API", () => {
  it("注册 → 返回用户并种会话 cookie → /api/me 可读", async () => {
    const res = await post("/api/auth/register", {
      email: "new@x.com",
      password: "password123",
      name: "New",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.email).toBe("new@x.com");

    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`${SESSION_COOKIE}=`);
    expect(setCookie).toContain("HttpOnly");

    const meRes = await app.request("/api/me", {
      headers: { cookie: `${SESSION_COOKIE}=${tokenOf(res)}` },
    });
    expect(meRes.status).toBe(200);
    expect((await meRes.json()).user.id).toBe(body.user.id);
  });

  it("注册校验：非法邮箱 / 短密码 400，重复邮箱 409", async () => {
    expect((await post("/api/auth/register", { email: "bad", password: "password123" })).status).toBe(400);
    expect((await post("/api/auth/register", { email: "a@x.com", password: "short" })).status).toBe(400);

    await post("/api/auth/register", { email: "dup@x.com", password: "password123" });
    const dup = await post("/api/auth/register", { email: "DUP@x.com", password: "password123" });
    expect(dup.status).toBe(409);
    expect((await dup.json()).code).toBe("EMAIL_EXISTS");
  });

  it("登录：成功种 cookie；错误密码/未知邮箱 401", async () => {
    await post("/api/auth/register", { email: "u@x.com", password: "password123" });

    const ok = await post("/api/auth/login", { email: "u@x.com", password: "password123" });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("set-cookie")).toContain(`${SESSION_COOKIE}=`);

    const badPass = await post("/api/auth/login", { email: "u@x.com", password: "wrong" });
    expect(badPass.status).toBe(401);

    const ghost = await post("/api/auth/login", { email: "ghost@x.com", password: "password123" });
    expect(ghost.status).toBe(401);
  });

  it("注销：清除 cookie 且会话立即失效", async () => {
    const reg = await post("/api/auth/register", { email: "o@x.com", password: "password123" });
    const token = tokenOf(reg);

    const out = await app.request("/api/auth/logout", {
      method: "POST",
      headers: { cookie: `${SESSION_COOKIE}=${token}` },
    });
    expect(out.status).toBe(200);
    expect(out.headers.get("set-cookie")).toContain(`${SESSION_COOKIE}=;`);

    const meRes = await app.request("/api/me", {
      headers: { cookie: `${SESSION_COOKIE}=${token}` },
    });
    expect(meRes.status).toBe(401);
  });

  it("/api/me 无 cookie 返回 401", async () => {
    const res = await app.request("/api/me");
    expect(res.status).toBe(401);
    expect((await res.json()).user).toBeNull();
  });

  it("非 JSON 请求体返回 400 而非 500", async () => {
    const res = await app.request("/api/auth/register", { method: "POST", body: "not-json" });
    expect(res.status).toBe(400);
  });

  it("未命中的 /api 路径返回 JSON 404（不被 SPA 回退吞掉）", async () => {
    const res = await app.request("/api/nope");
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Not found");
  });
});
