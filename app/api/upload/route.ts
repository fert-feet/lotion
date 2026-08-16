// POST /api/upload —— 图片上传（multipart form-data，字段名 file）
// ⚠️ 存储决策（D7）：当前存本地磁盘 data/uploads/，经 /api/uploads/[filename] 提供访问。
// TODO(后期)：单机部署换云时，将本路由改为图床存储（如 S3/Cloudflare R2/OBS），
// 返回的 url 字段对外契约不变（前端只消费 { url }），无需改组件。
import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { userFromRequest } from "@/lib/local/request-user";
import { newId } from "@/lib/local/sqlite";

const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
const ALLOWED_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

export function resolveUploadDir(): string {
  return process.env.UPLOAD_DIR ?? path.join(process.cwd(), "data", "uploads");
}

export async function POST(request: Request) {
  const user = userFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "需要 multipart/form-data" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "缺少 file 字段" }, { status: 400 });
  }

  const ext = ALLOWED_EXT[file.type];
  if (!ext) {
    return NextResponse.json({ error: "仅支持 png/jpeg/webp/gif 图片" }, { status: 400 });
  }
  if (file.size > MAX_SIZE_BYTES) {
    return NextResponse.json({ error: "图片超过 10MB 限制" }, { status: 400 });
  }

  const name = `${newId()}.${ext}`;
  const dir = resolveUploadDir();
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, name), Buffer.from(await file.arrayBuffer()));

  return NextResponse.json({ url: `/api/uploads/${name}` });
}
