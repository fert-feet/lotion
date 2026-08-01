"use client";

import { createClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";
import { createContext, useContext, useEffect, useState } from "react";

type UserState = {
  user: User | null;
  loading: boolean;
};

const UserContext = createContext<UserState>({ user: null, loading: true });

/**
 * 在 root layout（server）中注入 SSR 得到的 user。
 * 所有 useSupabaseUser 调用方共享同一份 user state：
 * - 首帧即有 user，Search/Settings/文档列表无需等待客户端 getUser
 * - 所有 Item 同时拿到 user，一次 commit 渲染，消除"文档逐个出现"
 */
export function UserProvider({
  ssrUser,
  children,
}: {
  ssrUser: User | null;
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
    // 兜底：cookie 与 localStorage 可能不一致（如登录后 cookie 过期），
    // 客户端再恢复一次。全应用仅此一个 getUser 请求。
    createClient()
      .auth.getUser()
      .then(({ data }) => {
        setState({ user: data.user, loading: false });
      })
      .catch(() => {
        setState({ user: null, loading: false });
      });
  }, [ssrUser]);

  return <UserContext.Provider value={state}>{children}</UserContext.Provider>;
}

export function useSupabaseUser() {
  return useContext(UserContext);
}
