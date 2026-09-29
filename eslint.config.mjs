// ESLint 扁平配置（Vite 版）。
// 迁移说明：原配置 extends "next/core-web-vitals" + "next/typescript"，
// 依赖 eslint-config-next。移除 Next.js 后改为标准组合：
//   @eslint/js 推荐规则 + typescript-eslint 推荐规则 + react-hooks 规则
// 其中 react-hooks/exhaustive-deps 保留为 warn（原 Next 配置同样只警告）。
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "data/**",
      "logs/**",
      "public/**",
      "coverage/**",
      "*.config.mjs",
      "*.config.ts",
      "*.config.mts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    languageOptions: {
      globals: {
        window: "readonly",
        document: "readonly",
        navigator: "readonly",
        fetch: "readonly",
        console: "readonly",
        process: "readonly",
        Buffer: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        FormData: "readonly",
        File: "readonly",
        Blob: "readonly",
        Response: "readonly",
        Request: "readonly",
        Headers: "readonly",
        URL: "readonly",
        globalThis: "readonly",
      },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // 以 _ 开头的未使用参数视为"刻意保留的 API 兼容位"（如 lib/db.ts 的 _userId）
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
);
