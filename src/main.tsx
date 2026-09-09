// 客户端入口（Vite SPA）。
// 样式加载顺序：字体 → 全局设计系统 → Markdown 渲染样式。
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/fonts.css";
import "./styles/globals.css";
import "@/components/markdown/markdown.css";
import App from "./app";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
