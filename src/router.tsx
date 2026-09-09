// 路由表：对应迁移前的 App Router 目录结构
//
//   app/(marketing)/page.tsx                     → "/"
//   app/login/page.tsx                           → "/login"
//   app/register/page.tsx                        → "/register"
//   app/(main)/(routes)/documents/page.tsx       → "/documents"
//   app/(main)/(routes)/documents/[documentId]   → "/documents/:documentId"
//   app/(public)/(routes)/preview/[documentId]   → "/preview/:documentId"
//   app/(main)/layout.tsx（服务端守卫）           → MainLayout（客户端守卫 + AppShell）
//   app/(marketing)/layout.tsx                   → MarketingLayout
//   app/error.tsx                                → errorElement
//
// 页面级懒加载：/documents 与 /preview 体积最大（含 BlockNote 编辑器），单独切 chunk。
import { createBrowserRouter } from "react-router";
import { lazy, Suspense } from "react";
import { Spinner } from "@/components/ui/spinner";
import ErrorBoundary from "./pages/error-boundary";
import LoginPage from "./pages/login";
import RegisterPage from "./pages/register";
import DocumentsPage from "./pages/documents";
import NotFoundPage from "./pages/not-found";
import MarketingLayout from "./pages/marketing-layout";
import MarketingPage from "./pages/marketing";
import MainLayout from "./shell/main-layout";

const DocumentPage = lazy(() => import("./pages/document"));
const PreviewPage = lazy(() => import("./pages/preview"));

/** 页面 chunk 加载态 */
const PageFallback = () => (
  <div className="h-full flex items-center justify-center">
    <Spinner className="size-8" />
  </div>
);

export const routes = [
  {
    path: "/",
    element: <MarketingLayout />,
    errorElement: <ErrorBoundary />,
    children: [{ index: true, element: <MarketingPage /> }],
  },
  { path: "/login", element: <LoginPage />, errorElement: <ErrorBoundary /> },
  { path: "/register", element: <RegisterPage />, errorElement: <ErrorBoundary /> },
  {
    // 认证区：MainLayout 内含会话守卫（未登录重定向 /login）
    element: <MainLayout />,
    errorElement: <ErrorBoundary />,
    children: [
      { path: "documents", element: <DocumentsPage /> },
      {
        path: "documents/:documentId",
        element: (
          <Suspense fallback={<PageFallback />}>
            <DocumentPage />
          </Suspense>
        ),
      },
    ],
  },
  {
    path: "/preview/:documentId",
    element: (
      <Suspense fallback={<PageFallback />}>
        <PreviewPage />
      </Suspense>
    ),
    errorElement: <ErrorBoundary />,
  },
  { path: "*", element: <NotFoundPage /> },
] satisfies Parameters<typeof createBrowserRouter>[0];

export const router = createBrowserRouter(routes);
