// 应用根组件：全局 Provider + 路由。
// 迁移自 app/layout.tsx（Next.js RootLayout）——原 SSR 注入的 user 改为
// 客户端经 GET /api/me 引导（UserProvider 内置兜底），见 src/router.tsx 的守卫。
// KernelProvider：客户端内核（docStore / uiSlots 等接缝）注入组件树，UI 不再直接 import 数据模块。
import { useMemo } from "react";
import { RouterProvider } from "react-router";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import ModalProvider from "@/components/providers/modal-provider";
import { UserProvider } from "@/hooks/use-user";
import { KernelProvider } from "./kernel/react";
import { shellUiPlugins } from "./shell/ui-plugins";
import { router } from "./router";

interface AppProps {
  /** 启动期从 /api/plugins/client-config 拿到的 disabled UI 插件 id */
  disabledUiPlugins?: string[];
}

const App = ({ disabledUiPlugins = [] }: AppProps) => {
  const options = useMemo(
    () => ({ extraPlugins: shellUiPlugins({ disabled: disabledUiPlugins }) }),
    [disabledUiPlugins],
  );

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      storageKey="Lotion-theme"
    >
      <Toaster position="top-right" />
      <KernelProvider options={options}>
        <UserProvider initialUser={null}>
          {/* 设置弹窗要用 kernel（插件管理）与 user（owner 判定），因此放进 Provider 内 */}
          <ModalProvider />
          <RouterProvider router={router} />
        </UserProvider>
      </KernelProvider>
    </ThemeProvider>
  );
};

export default App;
