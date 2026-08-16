// POST /api/auth/register —— 注册并直接建立会话（返回用户 + 种 cookie）
import { NextResponse } from "next/server";
import { getDb } from "@/lib/local/sqlite";
import {
  createUser,
  createSession,
  SESSION_COOKIE,
  sessionCookieOptions,
  AuthError,
} from "@/lib/local/auth";

export async function POST(request: Request) {
  let body: { email?: string; password?: string; name?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }
  const { email = "", password = "", name } = body;

  try {
    const user = createUser(getDb(), email, password, name || null);
    const token = createSession(getDb(), user.id);
    const res = NextResponse.json({ user });
    res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
    return res;
  } catch (e) {
    if (e instanceof AuthError) {
      const status = e.code === "EMAIL_EXISTS" ? 409 : 400;
      return NextResponse.json({ error: e.message, code: e.code }, { status });
    }
    throw e;
  }
}
