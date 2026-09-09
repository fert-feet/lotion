// 着陆页布局（公开）。
// 迁移自 app/(marketing)/layout.tsx——children 改为 React Router 的 <Outlet />。
import { Outlet } from "react-router";
import Navbar from "@/src/marketing/navbar";

const MarketingLayout = () => (
  <div className="h-full">
    <Navbar />
    <main className="h-full pt-32">
      <Outlet />
    </main>
  </div>
);

export default MarketingLayout;
