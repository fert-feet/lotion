// GET /api/me —— 当前登录用户（客户端会话恢复入口）
import { Hono } from "hono";
import { getDb } from "@/lib/local/sqlite";
import { getSessionUser, parseCookies, SESSION_COOKIE } from "@/lib/local/auth";
import type { AppEnv } from "../http";

export const meRoutes = new Hono<AppEnv>();

meRoutes.get("/", (c) => {
  const token = parseCookies(c.req.header("cookie") ?? null)[SESSION_COOKIE];
  const user = getSessionUser(getDb(), token);
  if (!user) return c.json({ user: null }, 401);
  return c.json({ user });
});
