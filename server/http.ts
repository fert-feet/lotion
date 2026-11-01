// Hono 公共工具：JSON 解析与统一错误响应。
import type { Context } from "hono";
import type { Context as KernelContext } from "@/lib/kernel";
import type { LocalUser } from "@/lib/local/auth";

/** 注入到 Hono Context 的类型：Bindings 放内核上下文；Variables 放 requireAuth 的用户 */
export type AppEnv = {
  Bindings: {
    /** 宿主内核上下文（createApp 的分发器通过 env 传给子应用） */
    kernel?: KernelContext;
  };
  Variables: {
    user: LocalUser;
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
