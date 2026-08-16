// PUT /api/documents/[documentId]/move —— 移动文档（设置父文档；null = 移到根目录）。
// 与 AI moveNote 工具配合：工具只发确认请求，用户在前端确认后经本端点真正执行。
// 目标父文档必须存在、属于当前用户且未归档；防循环引用（不能移到自身或子孙下）。
import { NextResponse } from "next/server";
import { getDb } from "@/lib/local/sqlite";
import { userFromRequest } from "@/lib/local/request-user";
import { getDocumentById, getDescendantIds, moveDocument } from "@/lib/local/db";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ documentId: string }> },
) {
  const user = userFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { documentId } = await params;
  let body: { parentDocument?: string | null };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "body 必须是 JSON" }, { status: 400 });
  }
  const newParentId = body.parentDocument ?? null;

  const existing = getDocumentById(getDb(), documentId, user.id);
  if (!existing) {
    return NextResponse.json({ error: "文档不存在或无权访问" }, { status: 404 });
  }

  if (newParentId !== null) {
    const target = getDocumentById(getDb(), newParentId, user.id);
    if (!target) {
      return NextResponse.json({ error: "目标父文档不存在或无权访问" }, { status: 400 });
    }
    if (target.isArchived) {
      return NextResponse.json({ error: "目标父文档已归档" }, { status: 400 });
    }
    if (getDescendantIds(getDb(), user.id, documentId).includes(newParentId)) {
      return NextResponse.json({ error: "不能移动到自身或其子文档下（循环引用）" }, { status: 400 });
    }
  }

  if (!moveDocument(getDb(), user.id, documentId, newParentId)) {
    return NextResponse.json({ error: "移动失败" }, { status: 400 });
  }
  return NextResponse.json({ ok: true, parentDocument: newParentId });
}
