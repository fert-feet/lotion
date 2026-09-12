// 接缝：httpRoutes —— HTTP 路由的贡献点（Service Definition）。
//
// 三角色：
//   Definition ← 本文件：注册表契约 + 装配期校验（路径唯一）
//   Provider   ← 装配方创建一个注册表并 provide（server 侧把它接到 Hono 上）
//   Consumer   ← 每个路由插件把自己的子应用注册进来（如 server/routes/*）
//
// 为什么需要它：此前 server/app.ts **静态**挂 8 个路由模块 —— 加一个端点要改装配文件。
// 有了注册表，"路由"就成了插件的副作用：插件挂载即注册、卸载即消失（可逆），
// 装配层只负责把注册表接上 Hono。
//
// 泛型 `SubApp` 让本文件不依赖 Hono（子系统传入自己的子应用类型），
// 保持 lib/seams 无框架耦合。
import { Context } from "@/lib/kernel";

/** 一条已注册的路由条目 */
export interface HttpRouteEntry<SubApp> {
  /** 挂载路径（如 "/documents"） */
  path: string;
  /** 子应用（server 侧是 Hono<AppEnv>） */
  app: SubApp;
  /** 注册者（fiber 名，审计用） */
  owner: string;
}

export interface HttpRouteRegistry<SubApp> {
  /**
   * 注册子路由。
   * @throws 路径重复注册时抛错（一个路径一个所有者，避免两个插件抢同一段 API）
   */
  route(path: string, app: SubApp): void;
  /** 已注册条目（装配审计/挂载用） */
  entries(): ReadonlyArray<HttpRouteEntry<SubApp>>;
}

export const HTTP_ROUTES_SERVICE = "httpRoutes";

/** 创建注册表（装配方调用；owner 由传入的回调决定） */
export function createHttpRouteRegistry<SubApp>(
  resolveOwner: () => string = () => "unknown",
): HttpRouteRegistry<SubApp> {
  const registered: HttpRouteEntry<SubApp>[] = [];
  return {
    route(path: string, app: SubApp) {
      if (typeof path !== "string" || path.trim() === "") {
        throw new Error("[httpRoutes] 路由路径不能为空");
      }
      const normalized = normalizePath(path);
      const existing = registered.find((entry) => entry.path === normalized);
      if (existing) {
        throw new Error(
          `[httpRoutes] 路径「${normalized}」已由「${existing.owner}」注册，不能重复注册`,
        );
      }
      registered.push({ path: normalized, app, owner: resolveOwner() });
    },
    entries: () => [...registered],
  };
}

/** 装配注册表 */
export function provideHttpRoutes<SubApp>(ctx: Context, registry: HttpRouteRegistry<SubApp>): void {
  if (typeof registry?.route !== "function" || typeof registry?.entries !== "function") {
    throw new Error("httpRoutes 实现不完整：需要 route() 与 entries()");
  }
  ctx.provide(HTTP_ROUTES_SERVICE, registry);
}

/** 读注册表；未装配返回 undefined */
export function findHttpRoutes<SubApp>(ctx: Context): HttpRouteRegistry<SubApp> | undefined {
  return ctx.get<HttpRouteRegistry<SubApp>>(HTTP_ROUTES_SERVICE);
}

/** 读注册表；未装配抛错（路由插件必须依赖它） */
export function requireHttpRoutes<SubApp>(ctx: Context): HttpRouteRegistry<SubApp> {
  const registry = findHttpRoutes<SubApp>(ctx);
  if (!registry) {
    throw new Error(
      `httpRoutes 未装配：请确认组合清单里挂载了 http-routes 提供方（服务 key「${HTTP_ROUTES_SERVICE}」）`,
    );
  }
  return registry;
}

/** 路径规范化：去尾斜杠、补前导斜杠（"/documents/" 与 "documents" 视为同一条） */
export function normalizePath(path: string): string {
  const trimmed = path.trim();
  const withLeading = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withLeading.length > 1 ? withLeading.replace(/\/+$/, "") : withLeading;
}
