// 本地版用户上下文：
// - Vite SPA 无 SSR 注入，初始值传 null，挂载后经 GET /api/me 恢复会话
// - 登录/注册成功后调用 refreshUser() 重新拉取（替代 Next 的 router.refresh()）
// 组件里 user.id / user.email 用法不变（LocalUser 与 Supabase User 字段对齐）。
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { LocalUser } from "@/lib/local/auth";

type UserState = {
  user: LocalUser | null;
  loading: boolean;
};

type UserContextValue = UserState & {
  /** 重新拉取当前会话（登录 / 注册 / 注销后调用） */
  refreshUser: () => Promise<void>;
};

const UserContext = createContext<UserContextValue>({
  user: null,
  loading: true,
  refreshUser: async () => {},
});

async function fetchMe(): Promise<LocalUser | null> {
  try {
    const res = await fetch("/api/me", { cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json();
    return (data.user as LocalUser) ?? null;
  } catch {
    return null;
  }
}

/**
 * 注入初始 user（可选；SPA 下通常为 null，由 /api/me 兜底恢复）。
 * 所有 useUser 调用方共享同一份 user state：
 * - 传入 initialUser 时首帧即有 user，Search/Settings/文档列表无需等待请求
 * - 所有 Item 同时拿到 user，一次 commit 渲染，消除"文档逐个出现"
 */
export function UserProvider({
  initialUser,
  children,
}: {
  initialUser: LocalUser | null;
  children: React.ReactNode;
}) {
  // 已注入 initialUser 立即就绪；否则保持 loading，由兜底请求恢复
  const [state, setState] = useState<UserState>({
    user: initialUser,
    loading: initialUser ? false : true,
  });

  const refreshUser = useCallback(async () => {
    const user = await fetchMe();
    setState({ user, loading: false });
  }, []);

  useEffect(() => {
    // initialUser 变化时同步 state（如登录后重新注入，null → User；
    // 否则 state 停留在旧值导致侧边栏空白直到刷新）
    if (initialUser) {
      setState({ user: initialUser, loading: false });
      return;
    }
    // 兜底：cookie 与页面状态可能不一致，客户端再恢复一次。全应用仅此一个 /api/me 请求。
    void refreshUser();
  }, [initialUser, refreshUser]);

  return (
    <UserContext.Provider value={{ ...state, refreshUser }}>{children}</UserContext.Provider>
  );
}

export function useUser() {
  return useContext(UserContext);
}
