// GET /api/me —— 当前登录用户（SSR 守卫与客户端兜底共用的会话查询入口）
import { NextResponse } from "next/server";
import { getDb } from "@/lib/local/sqlite";
import { getSessionUser, parseCookies, SESSION_COOKIE } from "@/lib/local/auth";

export async function GET(request: Request) {
  const token = parseCookies(request.headers.get("cookie"))[SESSION_COOKIE];
  const user = getSessionUser(getDb(), token);
  if (!user) {
    return NextResponse.json({ user: null }, { status: 401 });
  }
  return NextResponse.json({ user });
}
