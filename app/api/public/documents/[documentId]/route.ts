// GET /api/public/documents/[documentId] —— 公开预览专用只读端点（无鉴权）
// 仅返回 isPublished=true 的文档；本地单机语义（D8）：同一机器上的任何人都可看已发布笔记。
// TODO(后期)：上 Vercel 等公网部署时，此处需重新评估公开面（加访问令牌/分享链接机制），
// 并把封面图等资源与图床方案一起迁移。
import { NextResponse } from "next/server";
import { getDb } from "@/lib/local/sqlite";
import { getDocumentById } from "@/lib/local/db";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ documentId: string }> },
) {
  const { documentId } = await params;
  const doc = getDocumentById(getDb(), documentId);
  if (!doc || !doc.isPublished) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(doc);
}
