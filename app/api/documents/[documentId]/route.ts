// /api/documents/[documentId] —— 单文档读取 / 更新 / 删除
import { NextResponse } from "next/server";
import { getDb } from "@/lib/local/sqlite";
import { userFromRequest } from "@/lib/local/request-user";
import { getDocumentById, updateDocument, deleteDocument } from "@/lib/local/db";

const UPDATEABLE_FIELDS = ["title", "content", "coverImage", "icon", "isPublished", "isDraft"] as const;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ documentId: string }> },
) {
  const user = userFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { documentId } = await params;
  const doc = getDocumentById(getDb(), documentId, user.id);
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(doc);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ documentId: string }> },
) {
  const user = userFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }
  // 白名单过滤：未登录字段一律丢弃（防越权改 userId / isArchived 等）
  const fields: Record<string, unknown> = {};
  for (const key of UPDATEABLE_FIELDS) {
    if (key in body) fields[key] = body[key];
  }

  const { documentId } = await params;
  updateDocument(getDb(), documentId, fields as never);
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ documentId: string }> },
) {
  const user = userFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { documentId } = await params;
  deleteDocument(getDb(), documentId);
  return NextResponse.json({ ok: true });
}
