// 鉴权中间件（Hono）。
// 这是决策 D4 的原设计回归：Next.js 时代因 middleware 跑在 Edge runtime、
// 加载不了 better-sqlite3 原生模块而删除守卫，改在 (main)/layout 服务端布局里兜。
// Hono 中间件直接跑在 Node 上，可正常访问 SQLite 连接。
import type { Context, Next } from "hono";
import { userFromRequest } from "@/lib/local/request-user";
import type { AppEnv } from "./http";

/** 校验会话 cookie，注入 c.get("user")；未登录回 401 */
export async function requireAuth(c: Context<AppEnv>, next: Next) {
  const user = userFromRequest(c.req.raw);
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  c.set("user", user);
  await next();
}
