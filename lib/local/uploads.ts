// 上传目录解析（服务端专用）。
// 迁移自 app/api/upload/route.ts 的 resolveUploadDir——上传与读取两个路由共用，
// 抽到 lib/local 下避免路由文件互相 import。
import path from "node:path";

/** 本地图片存储目录（可用 UPLOAD_DIR 覆盖，默认 data/uploads） */
export function resolveUploadDir(): string {
  return process.env.UPLOAD_DIR ?? path.join(process.cwd(), "data", "uploads");
}
