// Hono 应用装配（纯路由，不监听端口——测试直接 import 本模块用 app.request 调用）。
//
// 路由来自 httpRoutes 注册表，但**不再启动时一次性挂载**：
// 这里用单个分发器按请求实时查表，因此插件卸载/重挂后路由立即生效（无需重建 app）。
// 这正是 M4 热切换的基础。
import { Hono } from "hono";
import type { Context as KernelContext } from "@/lib/kernel";
import type { HttpRouteEntry } from "@/lib/seams/http-routes";
import type { AppEnv } from "./http";
import { type ApiRouteRegistry, type ApiSubApp } from "./routes";

export interface CreateAppOptions {
  /** 宿主内核上下文：插件管理路由等需要从服务注册表取能力 */
  kernel?: KernelContext;
}

/**
 * 用注册表装配 /api/*；返回的 app 可直接 `app.request(path, init)` 测试。
 * @param routes - httpRoutes 注册表（生产来自宿主内核；测试用 createApiTestApp 构造）
 * @param options.kernel - 注入到 Hono Variables 的内核上下文
 */
export function createApp(routes: ApiRouteRegistry, options: CreateAppOptions = {}) {
  const api = new Hono<AppEnv>();
  const kernel = options.kernel;

  // 实时分发：每次请求都查注册表，插件卸载/重挂立即反映
  api.all("*", async (c) => {
    const rawPath = c.req.path;
    const path =
      rawPath === "/api" ? "/" : rawPath.startsWith("/api/") ? rawPath.slice(4) : rawPath;

    let matched: HttpRouteEntry<ApiSubApp> | undefined;
    for (const entry of routes.entries()) {
      if (path === entry.path || path.startsWith(`${entry.path}/`)) {
        if (!matched || entry.path.length > matched.path.length) matched = entry;
      }
    }
    if (!matched) return c.json({ error: "Not found" }, 404);

    const url = new URL(c.req.url);
    const rest = path.slice(matched.path.length) || "/";
    url.pathname = rest.startsWith("/") ? rest : `/${rest}`;

    const init: RequestInit & { duplex?: "half" } = {
      method: c.req.method,
      headers: c.req.raw.headers,
    };
    if (c.req.method !== "GET" && c.req.method !== "HEAD" && c.req.raw.body) {
      init.body = c.req.raw.body;
      init.duplex = "half";
    }
    return matched.app.fetch(new Request(url, init), kernel ? { kernel } : {});
  });

  const app = new Hono<AppEnv>();
  app.route("/api", api);

  // 未捕获异常 → JSON 500（Next.js 时代由框架兜底，这里显式处理）
  app.onError((err, c) => {
    console.error("[server] 未捕获异常:", err);
    return c.json({ error: "Internal Server Error" }, 500);
  });

  return app;
}

/** 已挂载的路由路径（启动日志/诊断用） */
export function routePaths(routes: ApiRouteRegistry): string[] {
  return routes.entries().map((entry) => entry.path);
}
