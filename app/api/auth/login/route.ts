// POST /api/auth/login —— 校验密码并建立会话（返回用户 + 种 cookie）
import { NextResponse } from "next/server";
import { getDb } from "@/lib/local/sqlite";
import {
  loginUser,
  createSession,
  SESSION_COOKIE,
  sessionCookieOptions,
  AuthError,
} from "@/lib/local/auth";

export async function POST(request: Request) {
  let body: { email?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }
  const { email = "", password = "" } = body;

  try {
    const user = loginUser(getDb(), email, password);
    const token = createSession(getDb(), user.id);
    const res = NextResponse.json({ user });
    res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
    return res;
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: 401 });
    }
    throw e;
  }
}
