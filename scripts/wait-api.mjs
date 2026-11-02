// dev 启动等待：先轮询 API 健康端点，再启动 Vite。
//
// 背景：`concurrently` 并行起 vite 与 Hono 时，Vite 约 70ms 就绪，而 API 要加载 SQLite /
// 内核（数百 ms）。浏览器先打开就会看到一串 ECONNREFUSED 代理错误；`/api/me` 失败后
// 用户态还会停在 null，设置里的插件页直接消失。等待 API 就绪能把整类竞态消掉。
const port = process.env.PORT ?? "3001";
const url = process.env.LOTION_HEALTH_URL ?? `http://localhost:${port}/api/health`;
const timeoutMs = Number(process.env.LOTION_WAIT_API_MS ?? 30_000);
const deadline = Date.now() + timeoutMs;

console.log(`[dev] 等待 API 就绪：${url}`);

while (Date.now() < deadline) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(1_000) });
    if (res.ok) {
      console.log("[dev] API 已就绪，启动 Vite");
      process.exit(0);
    }
  } catch {
    // 还没起来：继续轮询
  }
  await new Promise((resolve) => setTimeout(resolve, 200));
}

// 超时不阻塞前端：API 之后起来时，客户端重试仍能恢复
console.warn(`[dev] API 在 ${timeoutMs}ms 内未就绪，先启动 Vite（客户端会重试）`);
process.exit(0);
