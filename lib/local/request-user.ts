// 鉴权辅助：从请求 cookie 解析本地会话并返回当前用户。
// ⚠️ 服务端专用。原实现 import "server-only"（Next.js 打包守卫），
// 迁移到 Vite 后该包在 Node 下会直接抛错，故移除；隔离靠目录约定 + 构建期检查。

import { getDb } from "./sqlite";
import { getSessionUser, parseCookies, SESSION_COOKIE, type LocalUser } from "./auth";

export function userFromRequest(request: Request): LocalUser | null {
  const token = parseCookies(request.headers.get("cookie"))[SESSION_COOKIE];
  return getSessionUser(getDb(), token);
}
