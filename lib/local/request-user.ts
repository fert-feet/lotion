// ⚠️ 服务端专用模块。
// 从请求 cookie 解析本地会话并返回当前用户（各 REST 路由的公共鉴权入口）。

import { getDb } from "./sqlite";
import { getSessionUser, parseCookies, SESSION_COOKIE, type LocalUser } from "./auth";

export function userFromRequest(request: Request): LocalUser | null {
  const token = parseCookies(request.headers.get("cookie"))[SESSION_COOKIE];
  return getSessionUser(getDb(), token);
}
