// GET /api/chat/sessions/[sessionId]/messages —— 会话对话历史（?limit=N 可选）
import { NextResponse } from "next/server";
import { getDb } from "@/lib/local/sqlite";
import { userFromRequest } from "@/lib/local/request-user";
import { listChatHistory } from "@/lib/local/db";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const user = userFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { sessionId } = await params;
  const limitRaw = new URL(request.url).searchParams.get("limit");
  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;
  return NextResponse.json(
    listChatHistory(getDb(), user.id, sessionId, Number.isFinite(limit) ? limit : undefined),
  );
}
