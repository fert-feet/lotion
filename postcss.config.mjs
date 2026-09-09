// PostCSS 配置（Vite 使用）。
// 注意：Next.js 允许 plugins 写成字符串数组（["@tailwindcss/postcss"]），
// 但标准 PostCSS / Vite 要求对象形式（插件名 → 选项），迁移时已改写。
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
