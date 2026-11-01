// Hono 应用装配（纯路由，不监听端口——测试直接 import 本模块用 app.request 调用）。
//
// 路由**不再静态挂载**：全部来自 httpRoutes 注册表（每个路由插件挂载时注册自己的子应用），
// 本模块只做两件固定的事：把注册表接上 Hono、以及兜底（JSON 404 / JSON 500）。
import { Hono } from "hono";
import type { Context as KernelContext } from "@/lib/kernel";
import type { AppEnv } from "./http";
import type { ApiRouteRegistry } from "./routes";

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

  if (kernel) {
    api.use("*", async (c, next) => {
      c.set("kernel", kernel);
      await next();
    });
  }

  for (const entry of routes.entries()) {
    api.route(entry.path, entry.app);
  }

  // 未命中的 /api/* 一律 JSON 404（避免被 SPA 回退吞成 index.html）
  api.all("/*", (c) => c.json({ error: "Not found" }, 404));

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
