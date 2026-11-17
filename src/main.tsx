// 客户端入口（Vite SPA）。
// 样式加载顺序：字体 → 全局设计系统 → Markdown 渲染样式。
//
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/fonts.css";
import "./styles/globals.css";
import "@/components/markdown/markdown.css";
import App from "./app";

const root = createRoot(document.getElementById("root")!);

root.render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Service Worker（仅生产构建）：让应用可安装、断网时至少能打开外壳。
// 开发环境注册会缓存 dev 产物，导致改了代码看不到，所以只在 PROD 注册。
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch((e: unknown) => {
      // 注册失败不影响主流程（常见于非 HTTPS / 隐私模式），只记一行
      console.warn("[pwa] Service Worker 注册失败：", e);
    });
  });
}
