// /api/upload + /api/uploads/:filename —— 图片上传与读取/删除
// ⚠️ 存储决策（D7）：当前存本地磁盘 data/uploads/。
// TODO(后期)：单机部署换云时改为图床存储（S3/R2/OBS），`{ url }` 对外契约不变。
import { Hono } from "hono";
import fs from "node:fs/promises";
import path from "node:path";
import { newId } from "@/lib/local/sqlite";
import { resolveUploadDir } from "@/lib/local/uploads";
import type { AppEnv } from "../http";
import { requireAuth, UPLOAD_RATE_LIMIT, rateLimit } from "../middleware";

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
uploadRoutes.post("/", rateLimit(UPLOAD_RATE_LIMIT), async (c) => {
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

  const buffer = Buffer.from(await file.arrayBuffer());
  const dir = resolveUploadDir();
  await fs.mkdir(dir, { recursive: true });

  // 图片优化：超过 MAX_EDGE 的图缩到 MAX_EDGE（等比），非 GIF 转 webp。
  // 客户端永远拿同一个 `{ url }` 契约，尺寸由服务端决定。
  // GIF 保持原样（动图转码会丢帧），sharp 不可用或解码失败时原样落盘。
  const optimized = await optimizeImage(buffer, ext);
  const finalExt = optimized.ext;
  const name = `${newId()}.${finalExt}`;
  await fs.writeFile(path.join(dir, name), optimized.buffer);

  return c.json({ url: `/api/uploads/${name}` });
});

/** 长边上限（px）：2x 屏下 2048 足够清晰，再大基本是浪费带宽 */
const MAX_EDGE = 2048;

/**
 * 压缩/转码一张上传图。
 * @returns 落盘用的扩展名与字节
 */
async function optimizeImage(
  input: Buffer,
  ext: string,
): Promise<{ buffer: Buffer; ext: string }> {
  if (ext === "gif") return { buffer: input, ext };
  try {
    const { default: sharp } = await import("sharp");
    const image = sharp(input, { failOn: "error" });
    const meta = await image.metadata();
    const needsResize = (meta.width ?? 0) > MAX_EDGE || (meta.height ?? 0) > MAX_EDGE;
    const pipeline = needsResize
      ? image.resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true })
      : image;
    // 已经是 webp 且不需要缩放 → 保持原字节（避免二次有损编码）
    if (ext === "webp" && !needsResize) return { buffer: input, ext };
    const output = await pipeline.webp({ quality: 82 }).toBuffer();
    // 只有更小才替换（小图转 webp 反而可能变大）
    return output.length < input.length ? { buffer: output, ext: "webp" } : { buffer: input, ext };
  } catch {
    // 解码失败/未安装 sharp：原样保存，绝不让上传失败
    return { buffer: input, ext };
  }
}

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
