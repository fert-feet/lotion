// Hono 公共工具：JSON 解析与统一错误响应。
import type { Context } from "hono";
import type { Context as KernelContext } from "@/lib/kernel";
import type { LocalUser } from "@/lib/local/auth";

/** 注入到 Hono Context 的类型：requireAuth 写 user；createApp 注入内核 ctx（插件路由用） */
export type AppEnv = {
  Variables: {
    user: LocalUser;
    /** 宿主内核上下文（createApp 的 options.kernel；测试 / 仅路由场景可为空） */
    kernel?: KernelContext;
  };
};

/** 安全读取 JSON 请求体；解析失败返回 { ok: false } 由调用方回 400 */
export async function readJson<T>(
  c: Context,
): Promise<{ ok: true; data: T } | { ok: false }> {
  try {
    return { ok: true, data: (await c.req.json()) as T };
  } catch {
    return { ok: false };
  }
}

/** 统一的 401 响应 */
export function unauthorized(c: Context) {
  return c.json({ error: "Unauthorized" }, 401);
}
