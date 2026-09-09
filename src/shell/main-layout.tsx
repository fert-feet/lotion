import { Navigate, Outlet } from "react-router";
import AppShell from "./app-shell";
import { LazySearchCommand } from "./lazy-panels";
import { useUser } from "@/hooks/use-user";
import { Spinner } from "@/components/ui/spinner";

// 认证用户主界面的布局 + 守卫。
// 迁移说明：Next.js 版由服务端布局读 cookie 直接 redirect（D4 决策的产物）；
// SPA 无服务端渲染，改为等 /api/me 解析后客户端重定向——语义一致（未登录看不到主界面），
// 且服务端另有 Hono 中间件兜底（API 层一律 401）。
// 公开路由（/login /register /preview 与着陆页）不走本布局。
// 大块依赖（AiPanel/SearchCommand）经 lazy-panels 按需加载。
const MainLayout = () => {
  const { user, loading } = useUser();

  // 会话解析中：不闪登录页也不闪空壳，居中显示加载态
  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Spinner className="size-8" />
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;

  return (
    <div className="h-full">
      {/* DSH 风格三栏 shell：sidebar | center | details，见 app-shell.tsx */}
      <AppShell>
        <LazySearchCommand />
        <Outlet />
      </AppShell>
    </div>
  );
};

export default MainLayout;
