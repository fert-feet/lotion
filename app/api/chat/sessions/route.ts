// /api/chat/sessions —— AI 会话列表与创建
import { NextResponse } from "next/server";
import { getDb } from "@/lib/local/sqlite";
import { userFromRequest } from "@/lib/local/request-user";
import { listChatSessions, createChatSession } from "@/lib/local/db";

export async function GET(request: Request) {
  const user = userFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(listChatSessions(getDb(), user.id));
}

export async function POST(request: Request) {
  const user = userFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { title?: string };
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const id = createChatSession(getDb(), user.id, body.title || "新对话");
  return NextResponse.json({ id });
}
