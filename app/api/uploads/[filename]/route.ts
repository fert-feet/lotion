// GET/DELETE /api/uploads/[filename] —— 本地上传图片的读取与删除
// ⚠️ 与 /api/upload 配套的本地磁盘存储；TODO(后期)：换图床后此路由随上传路由一并退役。
import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { resolveUploadDir } from "@/app/api/upload/route";

const NAME_PATTERN = /^[0-9a-f-]{36}\.(png|jpg|webp|gif)$/;
const CONTENT_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

function safeName(filename: string): string | null {
  // 防路径穿越：只接受本服务生成的 UUID.ext 文件名
  return NAME_PATTERN.test(filename) ? filename : null;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ filename: string }> },
) {
  const { filename } = await params;
  const name = safeName(filename);
  if (!name) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const file = await fs.readFile(path.join(resolveUploadDir(), name));
    const ext = name.split(".").pop()!;
    return new Response(new Uint8Array(file), {
      headers: {
        "Content-Type": CONTENT_TYPES[ext],
        "Cache-Control": "public, max-age=31536000, immutable", // 文件名含 UUID，可永久缓存
      },
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ filename: string }> },
) {
  const { filename } = await params;
  const name = safeName(filename);
  if (!name) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    await fs.unlink(path.join(resolveUploadDir(), name));
    return NextResponse.json({ ok: true });
  } catch {
    // 文件已不存在视为删除成功（幂等）
    return NextResponse.json({ ok: true });
  }
}
