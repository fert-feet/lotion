export function titleForPath(pathname: string): string {
  if (pathname === "/") return "Lotion — AI 笔记";
  if (pathname === "/login") return "登录 · Lotion";
  if (pathname === "/register") return "注册 · Lotion";
  if (pathname === "/documents") return "笔记 · Lotion";
  if (pathname.startsWith("/documents/")) return "文档 · Lotion";
  if (pathname === "/market") return "插件市场 · Lotion";
  return "页面不存在 · Lotion";
}
