// 路由表（阶段 P1 占位，P3 替换为真实页面）。
import { createBrowserRouter } from "react-router";

export const router = createBrowserRouter([
  {
    path: "*",
    element: <div className="p-8 text-foreground">Lotion · Vite 脚手架就绪</div>,
  },
]);
