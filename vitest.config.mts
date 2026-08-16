import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
  },
  // tsconfig jsx: preserve 会让 oxc（vite 8 替代 esbuild 的转换器）保留 JSX，
  // 测试内的 .tsx 无法被 import-analysis 解析；此处显式走 automatic runtime
  oxc: {
    jsx: "react-jsx",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      // server-only 包在非 Next 打包环境会抛错，测试中用空模块替代
      "server-only": path.resolve(__dirname, "test/mocks/server-only.ts"),
    },
  },
});
