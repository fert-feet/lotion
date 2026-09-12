// 测试用 API app 装配：用一个**极简内核**装配内置路由插件，再交给 createApp。
//
// 为什么不直接 createApp()：路由现在是插件注册出来的（httpRoutes 注册表）。
// 测试需要的是"与生产同一条装配路径，但不碰真实 data/lotion.db" ——
// 本模块只挂 http-routes + 路由插件（路由自身的数据访问走被 mock 的 getDb），
// 不挂 settings/docStore 提供方，因此不会创建/打开真实库文件。
import { createRootContext, type Context } from "@/lib/kernel";
import { loadPlugins } from "@/lib/kernel";
import { createHttpRouteRegistry, provideHttpRoutes } from "@/lib/seams/http-routes";
import { createApp } from "@/server/app";
import { apiRoutePlugins, type ApiSubApp } from "@/server/routes";

/**
 * 构造 `app.request(path, init)` 可直接调用的测试应用。
 * @param extraPlugins - 追加的插件条目（测试要验证"插件注册路由"时用）
 */
export async function createApiTestApp(extraPlugins: Parameters<typeof loadPlugins>[1] = []) {
  const ctx = createRootContext();
  const routes = createHttpRouteRegistry<ApiSubApp>(() => ctx.fiber.name);
  const registryPlugin = {
    id: "http-routes",
    plugin: { name: "http-routes", apply: (c: Context) => provideHttpRoutes(c, routes) },
  };

  await loadPlugins(ctx, [registryPlugin, ...apiRoutePlugins(), ...extraPlugins]);

  const app = createApp(routes);
  return { app, ctx, routes };
}
