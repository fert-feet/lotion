// DELETE /api/chat/sessions/[sessionId] —— 删除会话（消息级联删除）
import { NextResponse } from "next/server";
import { getDb } from "@/lib/local/sqlite";
import { userFromRequest } from "@/lib/local/request-user";
import { deleteChatSession } from "@/lib/local/db";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const user = userFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { sessionId } = await params;
  deleteChatSession(getDb(), user.id, sessionId);
  return NextResponse.json({ ok: true });
}
