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

// ---------------------------------------------------------------------------
// 限流（进程内滑动窗口）
//
// 背景：登录 / 注册 / 上传此前完全没有限流。scrypt 一次要 30–60ms（升级到
// N=2^17 后更久），裸奔的登录端点等于给攻击者一个免费的 CPU 放大器。
// 单机自托管场景下不需要 Redis，进程内 Map 足够；多进程部署再换外部存储。
// ---------------------------------------------------------------------------

export interface RateLimitOptions {
  /** 窗口长度（毫秒） */
  windowMs: number;
  /** 窗口内允许的请求数 */
  max: number;
  /** 超限时是否连成功的请求也计入（登录场景需要） */
  keyOf?: (c: Context<AppEnv>) => string;
}

interface Bucket {
  /** 当前窗口起点 */
  start: number;
  count: number;
}

const buckets = new Map<string, Bucket>();

/** 清空限流状态（测试用） */
export function resetRateLimit(): void {
  buckets.clear();
}

/**
 * 固定窗口限流中间件。key 默认取 `CF-Connecting-IP` / `X-Forwarded-For` / 直连地址，
 * 并按路由前缀分桶（登录失败与上传互不影响）。
 * @returns 超限时 429 + Retry-After
 */
export function rateLimit(options: RateLimitOptions) {
  return async (c: Context<AppEnv>, next: Next) => {
    const now = Date.now();
    const ip =
      c.req.header("cf-connecting-ip") ??
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
      c.req.header("x-real-ip") ??
      "local";
    const key = options.keyOf?.(c) ?? `${c.req.path}:${ip}`;
    const bucket = buckets.get(key);

    if (!bucket || now - bucket.start >= options.windowMs) {
      buckets.set(key, { start: now, count: 1 });
      await next();
      return;
    }

    if (bucket.count >= options.max) {
      const retryAfter = Math.max(1, Math.ceil((options.windowMs - (now - bucket.start)) / 1000));
      c.header("Retry-After", String(retryAfter));
      return c.json({ error: "请求过于频繁，请稍后再试" }, 429);
    }

    bucket.count += 1;
    await next();
  };
}

/** 登录/注册限流参数：每 IP 每分钟 10 次 */
export const AUTH_RATE_LIMIT: RateLimitOptions = { windowMs: 60_000, max: 10 };
/** 上传限流参数：每 IP 每分钟 30 次 */
export const UPLOAD_RATE_LIMIT: RateLimitOptions = { windowMs: 60_000, max: 30 };
