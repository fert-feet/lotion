import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Fraunces, Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import "../components/markdown/markdown.css";
import { ThemeProvider } from "../components/providers/theme-provider";
import { Toaster } from "../components/ui/sonner";
import ModalProvider from "../components/providers/modal-provider";
import { UserProvider } from "../hooks/use-user";
import { getDb } from "@/lib/local/sqlite";
import { getSessionUser, SESSION_COOKIE, type LocalUser } from "@/lib/local/auth";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// 显示字体：Fraunces（印刷手稿气质），只用于标题/logo，正文保持 Geist
const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  weight: "variable",
  axes: ["opsz", "SOFT", "WONK"],
});

export const metadata: Metadata = {
  //todo notes: 这里更改了图标

  title: "Lotion",
  description: "The connected workspace where better faster work happens",
  icons: {
    icon: [
      {
        media: "(prefers-color-scheme: light)",
        url: "/logo.svg",
        href: "/logo.svg"
      },
      {
        media: "(prefers-color-scheme: dark)",
        url: "/logo-dark.svg",
        href: "/logo-dark.svg"
      }
    ]
  }
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // SSR 时从 cookie 恢复本地会话，首帧 HTML 就包含 user，
  // 侧边栏按钮/文档列表无需等待客户端请求
  let user: LocalUser | null = null;
  try {
    const cookieStore = await cookies();
    user = getSessionUser(getDb(), cookieStore.get(SESSION_COOKIE)?.value);
  } catch {
    // 本地数据库不可用时降级为匿名渲染（公开页仍可访问）
  }

  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${fraunces.variable} antialiased`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
          storageKey="Lotion-theme"
        >
          <Toaster position="top-right" />
          <ModalProvider />
          <UserProvider initialUser={user}>{children}</UserProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
