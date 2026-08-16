// PATCH /api/documents/[documentId]/restore —— 递归恢复子树（父级仍归档时摘除）
import { NextResponse } from "next/server";
import { getDb } from "@/lib/local/sqlite";
import { userFromRequest } from "@/lib/local/request-user";
import { restoreDocument } from "@/lib/local/db";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ documentId: string }> },
) {
  const user = userFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { documentId } = await params;
  restoreDocument(getDb(), user.id, documentId);
  return NextResponse.json({ ok: true });
}
