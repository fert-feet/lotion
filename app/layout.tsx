import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "../components/providers/theme-provider";
import { Toaster } from "../components/ui/sonner";
import ModalProvider from "../components/providers/modal-provider";
import { UserProvider } from "../hooks/use-supabase-user";
import { createClient } from "@/lib/supabase/server";
import type { User } from "@supabase/supabase-js";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
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
  // SSR 时从 cookie 恢复 session，首帧 HTML 就包含 user，
  // 侧边栏按钮/文档列表无需等待客户端 getUser
  let user: User | null = null;
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    user = data.user;
  } catch {
    // Supabase 不可用时降级为匿名渲染（公开页仍可访问）
  }

  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
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
          <UserProvider ssrUser={user}>{children}</UserProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
