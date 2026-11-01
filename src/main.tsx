// 客户端入口（Vite SPA）。
// 样式加载顺序：字体 → 全局设计系统 → Markdown 渲染样式。
//
// 启动前先读一次 disabled UI 插件配置：内核装配是"一次性的"，等 React 渲染后再过滤已经来不及。
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/fonts.css";
import "./styles/globals.css";
import "@/components/markdown/markdown.css";
import { fetchDisabledUiPlugins } from "@/lib/client/plugin-boot";
import App from "./app";

const root = createRoot(document.getElementById("root")!);

async function boot() {
  const disabledUiPlugins = await fetchDisabledUiPlugins();
  root.render(
    <StrictMode>
      <App disabledUiPlugins={disabledUiPlugins} />
    </StrictMode>,
  );
}

void boot();
