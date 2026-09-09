// 服务端入口（单机自托管）：Hono 同时托管 REST API 与 Vite 构建产物。
// 开发：vite dev server（5173）代理 /api 到本进程（3001），见 vite.config.ts。
// 生产：pnpm build 生成 dist/ 后，本进程一并托管静态资源 + SPA 回退。
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import fs from "node:fs";
import path from "node:path";
import { createApp } from "./app";

const PORT = Number(process.env.PORT ?? 3001);
const distDir = path.join(process.cwd(), "dist");
const indexPath = path.join(distDir, "index.html");
const hasBuild = fs.existsSync(indexPath);

const app = createApp();

if (hasBuild) {
  // 静态资源：Vite 产物（含 assets/）与 public/（logo 等）
  app.use("/*", serveStatic({ root: "./dist" }));
  app.use("/*", serveStatic({ root: "./public" }));

  // SPA 回退：非 /api 的 GET 一律返回 index.html（客户端路由接管）
  app.get("*", (c) => c.html(fs.readFileSync(indexPath, "utf-8")));
}

serve({ fetch: app.fetch, port: PORT }, (info) => {
  const mode = hasBuild ? "（含静态资源 + SPA 回退）" : "（仅 API，客户端请用 vite dev）";
  console.log(`[server] Lotion 运行于 http://localhost:${info.port} ${mode}`);
});
