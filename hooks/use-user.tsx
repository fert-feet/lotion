"use client";

// 本地版用户上下文（原 Supabase 版本改造而来）：
// - SSR 由 app/layout.tsx 经本地会话注入，首帧即有 user
// - 客户端兜底改为 GET /api/me（本地 Auth 的会话查询端点）
// 组件里 user.id / user.email 用法不变（LocalUser 与 Supabase User 字段对齐）。
import { createContext, useContext, useEffect, useState } from "react";
import type { LocalUser } from "@/lib/local/auth";

type UserState = {
  user: LocalUser | null;
  loading: boolean;
};

const UserContext = createContext<UserState>({ user: null, loading: true });

/**
 * 在 root layout（server）中注入 SSR 得到的 user。
 * 所有 useUser 调用方共享同一份 user state：
 * - 首帧即有 user，Search/Settings/文档列表无需等待客户端请求
 * - 所有 Item 同时拿到 user，一次 commit 渲染，消除"文档逐个出现"
 */
export function UserProvider({
  ssrUser,
  children,
}: {
  ssrUser: LocalUser | null;
  children: React.ReactNode;
}) {
  // SSR 已注入 user 立即就绪；否则保持 loading，由兜底请求恢复
  const [state, setState] = useState<UserState>({
    user: ssrUser,
    loading: ssrUser ? false : true,
  });

  useEffect(() => {
    // SSR 注入的 user 变化时同步 state（如登录后 router.refresh() 重新 SSR，
    // ssrUser 从 null → User；否则 state 停留在旧值导致侧边栏空白直到 F5）
    if (ssrUser) {
      setState({ user: ssrUser, loading: false });
      return;
    }
    // 兜底：cookie 与页面状态可能不一致，客户端再恢复一次。全应用仅此一个 /api/me 请求。
    fetch("/api/me", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) return null;
        const data = await res.json();
        return (data.user as LocalUser) ?? null;
      })
      .then((user) => setState({ user, loading: false }))
      .catch(() => {
        setState({ user: null, loading: false });
      });
  }, [ssrUser]);

  return <UserContext.Provider value={state}>{children}</UserContext.Provider>;
}

export function useUser() {
  return useContext(UserContext);
}
