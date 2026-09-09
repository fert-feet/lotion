import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
  },
  // tsconfig 已改为 jsx: "react-jsx"（迁移前为 Next 要求的 preserve），
  // 此处保留显式 oxc 配置以免将来 tsconfig 变动再次打断 .tsx 测试。
  oxc: {
    jsx: "react-jsx",
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "."),
    },
  },
});
