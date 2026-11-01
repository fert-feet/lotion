// 静态插件热切换：启停即挂载/卸载；配合实时路由分发，路由立即出现/消失。
import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import {
  createRootContext,
  settle,
  type Context,
  type Fiber,
  type PluginEntry,
} from "@/lib/kernel";
import { createApp } from "@/server/app";
import type { AppEnv } from "@/server/http";
import type { ApiSubApp } from "@/server/routes";
import {
  createHttpRouteRegistry,
  provideHttpRoutes,
  registerRoute,
  requireHttpRoutes,
} from "@/lib/seams/http-routes";
import { createToolRegistry, provideTools, registerTool, requireTools } from "@/lib/seams/tools";
import { registerDynamicPluginTools } from "@/lib/dynamic/tools";
import { createStaticPluginController } from "@/lib/local/static-plugin-controller";

function toolEntry(): PluginEntry {
  return {
    id: "tool-demo",
    plugin: {
      name: "tool-demo",
      inject: ["tools"],
      apply: (ctx: Context) => {
        registerTool(ctx, requireTools(ctx), {
          name: "demo_tool",
          label: "Demo",
          icon: "🧪",
          description: "demo",
          create: () => ({}),
        });
      },
    },
  };
}

describe("createStaticPluginController", () => {
  it("enable/disable 与 tools 副作用可逆", async () => {
    const ctx = createRootContext();
    provideTools(ctx, createToolRegistry<unknown>());
    const controller = createStaticPluginController({
      ctx,
      entries: [toolEntry()],
      fibers: new Map(),
    });

    expect(await controller.enable("tool-demo")).toEqual({ ok: true });
    expect(controller.running("tool-demo")).toBe(true);
    expect(requireTools(ctx).names()).toContain("demo_tool");

    await controller.disable("tool-demo");
    expect(controller.running("tool-demo")).toBe(false);
    expect(requireTools(ctx).names()).not.toContain("demo_tool");
  });

  it("启用失败记录可读错误；未知 id 返回失败", async () => {
    const ctx = createRootContext();
    const controller = createStaticPluginController({
      ctx,
      entries: [
        {
          id: "bad",
          plugin: {
            name: "bad",
            apply: () => {
              throw new Error("boom");
            },
          },
        },
      ],
      fibers: new Map(),
    });

    const failed = await controller.enable("bad");
    expect(failed.ok).toBe(false);
    expect(failed.error).toContain("boom");
    expect(controller.error("bad")).toContain("boom");

    expect((await controller.enable("ghost")).ok).toBe(false);
  });

  it("plugin_* 工具注册可逆：fiber 卸载后下线", async () => {
    const ctx = createRootContext();
    provideTools(ctx, createToolRegistry<unknown>());
    const fiber = ctx.plugin({
      name: "dyn-tools",
      apply: (pluginCtx: Context) => {
        registerDynamicPluginTools(pluginCtx, requireTools(pluginCtx));
      },
    } as Parameters<Context["plugin"]>[0]) as unknown as Fiber;
    await settle(fiber);

    expect(requireTools(ctx).names()).toContain("plugin_define");
    await fiber.dispose();
    expect(requireTools(ctx).names()).not.toContain("plugin_define");
  });

  it("路由注册可逆：enable 后 200，disable 后 404", async () => {
    const ctx = createRootContext();
    const routes = createHttpRouteRegistry<ApiSubApp>(() => "test");
    provideHttpRoutes(ctx, routes);

    const sub = new Hono<AppEnv>();
    sub.get("/ping", (c) => c.json({ pong: true }));
    const entry: PluginEntry = {
      id: "route-live",
      plugin: {
        name: "route-live",
        inject: ["httpRoutes"],
        apply: (pluginCtx: Context) => {
          registerRoute(pluginCtx, requireHttpRoutes<ApiSubApp>(pluginCtx), "/live", sub);
        },
      },
    };

    const controller = createStaticPluginController({ ctx, entries: [entry], fibers: new Map() });
    const app = createApp(routes);

    expect((await app.request("/api/live/ping")).status).toBe(404);

    expect(await controller.enable("route-live")).toEqual({ ok: true });
    expect(routes.entries().map((item) => item.path)).toContain("/live");
    const ok = await app.request("/api/live/ping");
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ pong: true });

    await controller.disable("route-live");
    expect(routes.entries().map((item) => item.path)).not.toContain("/live");
    expect((await app.request("/api/live/ping")).status).toBe(404);
  });
});
