// POST /api/auth/logout —— 删除会话并清除 cookie
import { NextResponse } from "next/server";
import { getDb } from "@/lib/local/sqlite";
import {
  deleteSession,
  parseCookies,
  SESSION_COOKIE,
  sessionCookieOptions,
} from "@/lib/local/auth";

export async function POST(request: Request) {
  const token = parseCookies(request.headers.get("cookie"))[SESSION_COOKIE];
  deleteSession(getDb(), token);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { ...sessionCookieOptions(), maxAge: 0 });
  return res;
}
