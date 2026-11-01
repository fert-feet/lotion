import { defineConfig } from "vitest/config";
import path from "node:path";

// 钉死测试环境：Vitest 只在 NODE_ENV 未设置时自动补 test；若外部 shell/CI 预设了
// NODE_ENV=production，React 会解析到 production 构建（不导出 act），jsdom 组件测试
// 会以 "act is not a function" 集体假失败。必须在被测模块加载前设置，故放在配置顶层。
process.env.NODE_ENV = "test";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
    // jsdom 缺失的浏览器 API（matchMedia / ResizeObserver / act 标志）统一在此补齐
    setupFiles: ["test/setup.ts"],
    // 同步给 worker 进程，避免只影响配置所在的宿主进程
    env: { NODE_ENV: "test" },
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "."),
    },
  },
});
