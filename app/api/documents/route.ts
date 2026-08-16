// /api/documents —— 文档列表（侧边栏/回收站/搜索候选）与创建
import { NextResponse } from "next/server";
import { getDb } from "@/lib/local/sqlite";
import { userFromRequest } from "@/lib/local/request-user";
import { listSidebarAll, listTrash, listSearch, createDocument } from "@/lib/local/db";

export async function GET(request: Request) {
  const user = userFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const scope = new URL(request.url).searchParams.get("scope") ?? "sidebar";
  const db = getDb();
  if (scope === "trash") return NextResponse.json(listTrash(db, user.id));
  if (scope === "search") return NextResponse.json(listSearch(db, user.id));
  return NextResponse.json(listSidebarAll(db, user.id));
}

export async function POST(request: Request) {
  const user = userFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { title?: string; parentDocument?: string | null };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }
  if (!body.title || typeof body.title !== "string") {
    return NextResponse.json({ error: "title 必填" }, { status: 400 });
  }
  const id = createDocument(getDb(), user.id, body.title, body.parentDocument ?? null);
  return NextResponse.json({ id });
}
