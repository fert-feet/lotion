// /api/auth/* —— 本地 Auth：注册 / 登录 / 注销
// 迁移自 app/api/auth/*（Next.js Route Handler → Hono 路由）
import { Hono } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";
import { getDb } from "@/lib/local/sqlite";
import {
  createUser,
  loginUser,
  createSession,
  deleteSession,
  parseCookies,
  SESSION_COOKIE,
  sessionCookieOptions,
  AuthError,
} from "@/lib/local/auth";
import { readJson, type AppEnv } from "../http";

export const authRoutes = new Hono<AppEnv>();

/** POST /api/auth/register —— 注册并直接建立会话（返回用户 + 种 cookie） */
authRoutes.post("/register", async (c) => {
  const parsed = await readJson<{ email?: string; password?: string; name?: string }>(c);
  if (!parsed.ok) return c.json({ error: "请求体不是合法 JSON" }, 400);
  const { email = "", password = "", name } = parsed.data;

  try {
    const user = createUser(getDb(), email, password, name || null);
    const token = createSession(getDb(), user.id);
    setCookie(c, SESSION_COOKIE, token, sessionCookieOptions());
    return c.json({ user });
  } catch (e) {
    if (e instanceof AuthError) {
      const status = e.code === "EMAIL_EXISTS" ? 409 : 400;
      return c.json({ error: e.message, code: e.code }, status);
    }
    throw e;
  }
});

/** POST /api/auth/login —— 校验密码并建立会话（返回用户 + 种 cookie） */
authRoutes.post("/login", async (c) => {
  const parsed = await readJson<{ email?: string; password?: string }>(c);
  if (!parsed.ok) return c.json({ error: "请求体不是合法 JSON" }, 400);
  const { email = "", password = "" } = parsed.data;

  try {
    const user = loginUser(getDb(), email, password);
    const token = createSession(getDb(), user.id);
    setCookie(c, SESSION_COOKIE, token, sessionCookieOptions());
    return c.json({ user });
  } catch (e) {
    if (e instanceof AuthError) {
      return c.json({ error: e.message, code: e.code }, 401);
    }
    throw e;
  }
});

/** POST /api/auth/logout —— 删除会话并清除 cookie */
authRoutes.post("/logout", async (c) => {
  const token = parseCookies(c.req.header("cookie") ?? null)[SESSION_COOKIE];
  deleteSession(getDb(), token);
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.json({ ok: true });
});
