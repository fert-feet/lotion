// httpRoutes 接缝单测：路径唯一 / 规范化 / 依赖门控 / 插件注册即路由（端到端）。
import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import { Context, loadPlugins, createRootContext, audit } from "@/lib/kernel";
import { mount } from "@/test/mocks/mount";
import {
  HTTP_ROUTES_SERVICE,
  createHttpRouteRegistry,
  findHttpRoutes,
  normalizePath,
  provideHttpRoutes,
  requireHttpRoutes,
} from "@/lib/seams/http-routes";
import { createApp, routePaths } from "@/server/app";

describe("lib/seams/http-routes 注册表", () => {
  it("注册并列出条目，owner 记录注册者", async () => {
    const registry = createHttpRouteRegistry<Hono>(() => "plugin/alpha");
    const sub = new Hono();

    registry.route("/alpha", sub);

    expect(registry.entries()).toEqual([{ path: "/alpha", app: sub, owner: "plugin/alpha" }]);
  });

  it("路径规范化：无前导斜杠、带尾斜杠都视为同一条", async () => {
    expect(normalizePath("documents")).toBe("/documents");
    expect(normalizePath("/documents/")).toBe("/documents");
    expect(normalizePath("/")).toBe("/");

    const registry = createHttpRouteRegistry<Hono>();
    registry.route("documents", new Hono());
    expect(() => registry.route("/documents/", new Hono())).toThrow(/已由「unknown」注册/);
  });

  it("路径重复注册抛错（一段 API 一个所有者）", async () => {
    const registry = createHttpRouteRegistry<Hono>(() => "plugin/a");
    registry.route("/dup", new Hono());
    expect(() => registry.route("/dup", new Hono())).toThrow(/路径「\/dup」已由「plugin\/a」注册/);
  });

  it("空路径抛错", async () => {
    const registry = createHttpRouteRegistry<Hono>();
    expect(() => registry.route("   ", new Hono())).toThrow(/路径不能为空/);
  });

  it("未装配时 requireHttpRoutes 抛可操作错误，find 返回 undefined", async () => {
    const ctx = createRootContext();
    expect(findHttpRoutes(ctx)).toBeUndefined();
    expect(() => requireHttpRoutes(ctx)).toThrow(/httpRoutes 未装配/);
  });

  it("服务随提供方插件卸载而消失（注册表条目随之作废）", async () => {
    const ctx = createRootContext();
    const fiber = await mount(ctx, {
      name: "http-routes",
      apply: (c: Context) => provideHttpRoutes(c, createHttpRouteRegistry<Hono>()),
    });
    expect(requireHttpRoutes(ctx)).toBeDefined();

    await fiber.dispose();

    expect(findHttpRoutes(ctx)).toBeUndefined();
  });
});

describe("server/app 由注册表装配", () => {
  it("注册表里的子应用成为真实路由；未注册路径返回 JSON 404", async () => {
    const registry = createHttpRouteRegistry<Hono>(() => "test");
    const sub = new Hono();
    sub.get("/ping", (c) => c.json({ pong: true }));
    registry.route("/demo", sub);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const app = createApp(registry as any);

    const ok = await app.request("/api/demo/ping");
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ pong: true });

    const missing = await app.request("/api/nope");
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "Not found" });
    // 路径前缀不会被误吞成静态资源
    expect(routePaths(registry as never)).toEqual(["/demo"]);
  });

  it("插件装配即路由（端到端）：加一个路由插件就有对应端点", async () => {
    const ctx = createRootContext();
    const registry = createHttpRouteRegistry<Hono>(() => ctx.fiber.name);
    const sub = new Hono();
    sub.get("/hello", (c) => c.json({ hello: "world" }));

    await loadPlugins(ctx, [
      { id: "http-routes", plugin: { name: "http-routes", apply: (c: Context) => provideHttpRoutes(c, registry) } },
      {
        id: "route-demo",
        plugin: {
          name: "route/demo",
          inject: [HTTP_ROUTES_SERVICE],
          apply: (c: Context) => requireHttpRoutes<Hono>(c).route("/demo", sub),
        },
      },
    ]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const app = createApp(registry as any);
    const res = await app.request("/api/demo/hello");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ hello: "world" });
  });

  it("依赖未就绪的路由插件保持 PENDING（不会被静默忽略）", async () => {
    const ctx = createRootContext();
    const spy = vi.fn();
    await mount(ctx, {
      name: "route/orphan",
      inject: [HTTP_ROUTES_SERVICE],
      apply: spy,
    });

    expect(spy).not.toHaveBeenCalled();
    expect(audit(ctx).pending).toEqual([{ name: "route/orphan", missing: [HTTP_ROUTES_SERVICE] }]);
  });
});
