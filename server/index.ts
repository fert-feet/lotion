// 服务端入口（单机自托管）：Hono 同时托管 REST API 与 Vite 构建产物。
// 开发：vite dev server（5173）代理 /api 到本进程（3001），见 vite.config.ts。
// 生产：pnpm build 生成 dist/ 后，本进程一并托管静态资源 + SPA 回退。
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import fs from "node:fs";
import path from "node:path";
import { loadEnvFiles } from "./load-env";

// ⚠️ env 必须在导入 ./app 之前加载完：app → routes → lib/agent、lib/compress 在
// **模块顶层**读 process.env（AI_MODEL），而 tsx/node 不会像 Next.js 那样自动读 .env 文件。
// 因此这里用动态 import（静态 import 会被提升到 loadEnvFiles() 之前执行）。
const loadedEnv = loadEnvFiles();
const { createApp } = await import("./app");

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

// 启动自检：env 文件加载结果 + DeepSeek key 是否就位（只打印文件名，绝不打印值）。
// 缺 key 时提前给出可操作的提示，而不是等用户在 AI 面板看到「API key is missing」。
if (loadedEnv.length > 0) {
  const names = loadedEnv.map((file) => path.relative(process.cwd(), file) || file);
  console.log(`[server] 已加载 env：${names.join("、")}`);
}
if (!process.env.DEEPSEEK_API_KEY) {
  console.warn("[server] ⚠️ 未检测到 DEEPSEEK_API_KEY：AI 助手会报「API key is missing」，请在 .env.local 配置或显式导出该变量");
}

serve({ fetch: app.fetch, port: PORT }, (info) => {
  const mode = hasBuild ? "（含静态资源 + SPA 回退）" : "（仅 API，客户端请用 vite dev）";
  console.log(`[server] Lotion 运行于 http://localhost:${info.port} ${mode}`);
});
