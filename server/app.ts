// Hono 应用装配（纯路由，不监听端口——测试直接 import 本模块用 app.request 调用）。
// 迁移自 Next.js app/api/**（16 个 Route Handler）。
import { Hono } from "hono";
import type { AppEnv } from "./http";
import { aiChatRoutes } from "./routes/ai-chat";
import { authRoutes } from "./routes/auth";
import { chatRoutes } from "./routes/chat";
import { documentsRoutes } from "./routes/documents";
import { meRoutes } from "./routes/me";
import { publicDocumentsRoutes } from "./routes/public-documents";
import { uploadRoutes, uploadsRoutes } from "./routes/upload";

/** 装配 /api/* 全部端点；返回的 app 可直接 app.request(path, init) 测试 */
export function createApp() {
  const api = new Hono<AppEnv>();

  api.route("/auth", authRoutes);
  api.route("/me", meRoutes);
  api.route("/documents", documentsRoutes);
  api.route("/chat/sessions", chatRoutes);
  api.route("/ai/chat", aiChatRoutes);
  api.route("/upload", uploadRoutes);
  api.route("/uploads", uploadsRoutes);
  api.route("/public/documents", publicDocumentsRoutes);

  // 未命中的 /api/* 一律 JSON 404（避免被 SPA 回退吞成 index.html）
  api.all("/*", (c) => c.json({ error: "Not found" }, 404));

  const app = new Hono<AppEnv>();
  app.route("/api", api);

  // 未捕获异常 → JSON 500（Next.js 时代由框架兜底，这里显式处理）
  app.onError((err, c) => {
    console.error("[server] 未捕获异常:", err);
    return c.json({ error: "Internal Server Error" }, 500);
  });

  return app;
}
