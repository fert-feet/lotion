// 应用根组件：全局 Provider + 路由。
// 迁移自 app/layout.tsx（Next.js RootLayout）——原 SSR 注入的 user 改为
// 客户端经 GET /api/me 引导（UserProvider 内置兜底），见 src/router.tsx 的守卫。
// KernelProvider：客户端内核（docStore / uiSlots 等接缝）注入组件树，UI 不再直接 import 数据模块。
import { RouterProvider } from "react-router";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import ModalProvider from "@/components/providers/modal-provider";
import { UserProvider } from "@/hooks/use-user";
import { KernelProvider } from "./kernel/react";
import { router } from "./router";

const App = () => (
  <ThemeProvider
    attribute="class"
    defaultTheme="system"
    enableSystem
    disableTransitionOnChange
    storageKey="Lotion-theme"
  >
    <Toaster position="top-right" />
    <ModalProvider />
    <KernelProvider>
      <UserProvider initialUser={null}>
        <RouterProvider router={router} />
      </UserProvider>
    </KernelProvider>
  </ThemeProvider>
);

export default App;
