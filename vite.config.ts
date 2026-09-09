// Vite 配置（客户端 SPA 构建）。
// 服务端（Hono）不参与本构建：直接用 tsx 运行 server/index.ts，无需打包。
// 开发时 Vite 代理 /api 到 Hono（端口 3001），生产时由 Hono 同时托管 dist/ 与 /api。
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

const API_PORT = process.env.PORT || "3001";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: `http://localhost:${API_PORT}`,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
  },
});
