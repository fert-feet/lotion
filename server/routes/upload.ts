// /api/upload + /api/uploads/:filename —— 图片上传与读取/删除
// ⚠️ 存储决策（D7）：当前存本地磁盘 data/uploads/。
// TODO(后期)：单机部署换云时改为图床存储（S3/R2/OBS），`{ url }` 对外契约不变。
import { Hono } from "hono";
import fs from "node:fs/promises";
import path from "node:path";
import { newId } from "@/lib/local/sqlite";
import { resolveUploadDir } from "@/lib/local/uploads";
import type { AppEnv } from "../http";
import { requireAuth } from "../middleware";

const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
const ALLOWED_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};
const NAME_PATTERN = /^[0-9a-f-]{36}\.(png|jpg|webp|gif)$/;
const CONTENT_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

/** 防路径穿越：只接受本服务生成的 UUID.ext 文件名 */
function safeName(filename: string): string | null {
  return NAME_PATTERN.test(filename) ? filename : null;
}

/** POST /api/upload —— 图片上传（multipart form-data，字段名 file） */
export const uploadRoutes = new Hono<AppEnv>();
uploadRoutes.use("*", requireAuth);
uploadRoutes.post("/", async (c) => {
  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    return c.json({ error: "需要 multipart/form-data" }, 400);
  }
  const file = form.get("file");
  if (!(file instanceof File)) return c.json({ error: "缺少 file 字段" }, 400);

  const ext = ALLOWED_EXT[file.type];
  if (!ext) return c.json({ error: "仅支持 png/jpeg/webp/gif 图片" }, 400);
  if (file.size > MAX_SIZE_BYTES) return c.json({ error: "图片超过 10MB 限制" }, 400);

  const name = `${newId()}.${ext}`;
  const dir = resolveUploadDir();
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, name), Buffer.from(await file.arrayBuffer()));

  return c.json({ url: `/api/uploads/${name}` });
});

/** GET/DELETE /api/uploads/:filename —— 本地上传图片的读取与删除（读取无鉴权，同原实现） */
export const uploadsRoutes = new Hono<AppEnv>();

uploadsRoutes.get("/:filename", async (c) => {
  const name = safeName(c.req.param("filename"));
  if (!name) return c.json({ error: "Not found" }, 404);

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
    return c.json({ error: "Not found" }, 404);
  }
});

uploadsRoutes.delete("/:filename", async (c) => {
  const name = safeName(c.req.param("filename"));
  if (!name) return c.json({ error: "Not found" }, 404);

  try {
    await fs.unlink(path.join(resolveUploadDir(), name));
  } catch {
    // 文件已不存在视为删除成功（幂等）
  }
  return c.json({ ok: true });
});
