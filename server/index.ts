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
const { bootHostKernel } = await import("./kernel");

// 宿主内核装配（组合根）：settings / docStore 提供方在此挂载。
// PORT 等配置改由内核的配置层读取（env > data/settings.json > 组合默认）。
const kernel = bootHostKernel();
const PORT = kernel.settings.server.get().port;
const distDir = path.join(process.cwd(), "dist");
const indexPath = path.join(distDir, "index.html");
const hasBuild = fs.existsSync(indexPath);

const app = createApp(kernel.httpRoutes);

if (hasBuild) {
  // 静态资源：Vite 产物（含 assets/）与 public/（logo 等）
  app.use("/*", serveStatic({ root: "./dist" }));
  app.use("/*", serveStatic({ root: "./public" }));

  // SPA 回退：非 /api 的 GET 一律返回 index.html（客户端路由接管）
  app.get("*", (c) => c.html(fs.readFileSync(indexPath, "utf-8")));
}

// 启动自检：env 加载结果 + 内核装配审计 + DeepSeek key 是否就位（只打印文件名，绝不打印值）。
if (loadedEnv.length > 0) {
  const names = loadedEnv.map((file) => path.relative(process.cwd(), file) || file);
  console.log(`[server] 已加载 env：${names.join("、")}`);
}
// 装配报告 + 审计：插件清单、禁用项、挂载失败、PENDING（缺服务）一律打印
// —— 否则"插件装了却不工作"只能靠猜
console.log(kernel.startupText);
if (!kernel.settings.ai.get().apiKey) {
  console.warn(
    "[server] ⚠️ 未检测到 DeepSeek API Key（配置层 ai.apiKey 为空）：AI 助手会报「API key is missing」，" +
      "请在 .env.local 设 DEEPSEEK_API_KEY，或写入 data/settings.json 的 { \"ai\": { \"apiKey\": \"...\" } }",
  );
}

serve({ fetch: app.fetch, port: PORT }, (info) => {
  const mode = hasBuild ? "（含静态资源 + SPA 回退）" : "（仅 API，客户端请用 vite dev）";
  console.log(`[server] Lotion 运行于 http://localhost:${info.port} ${mode}`);
});
