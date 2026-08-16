// PATCH /api/documents/[documentId]/archive —— 递归归档子树
import { NextResponse } from "next/server";
import { getDb } from "@/lib/local/sqlite";
import { userFromRequest } from "@/lib/local/request-user";
import { archiveDocument } from "@/lib/local/db";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ documentId: string }> },
) {
  const user = userFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { documentId } = await params;
  archiveDocument(getDb(), user.id, documentId);
  return NextResponse.json({ ok: true });
}
