import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      // server-only 包在非 Next 打包环境会抛错，测试中用空模块替代
      "server-only": path.resolve(__dirname, "test/mocks/server-only.ts"),
    },
  },
});
