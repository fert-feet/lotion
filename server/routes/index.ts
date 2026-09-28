// 内置 REST 路由的**组合清单**（路由即插件：每个模块把自己的子应用注册进 ctx.httpRoutes）。
//
// 加一个端点：在 server/routes/ 写模块 + 在这里加一行（稳定 id）—— 不再改 server/app.ts。
// 停用一段 API：在 data/settings.json 的 plugins 里按 id 禁用（走装配 patch）。
import type { Hono } from "hono";
import type { Context, PluginEntry } from "@/lib/kernel";
import { requireHttpRoutes, type HttpRouteRegistry } from "@/lib/seams/http-routes";
import type { AppEnv } from "../http";
import { aiChatRoutes } from "./ai-chat";
import { aiUndoRoutes } from "./ai-undo";
import { authRoutes } from "./auth";
import { chatRoutes } from "./chat";
import { documentsRoutes } from "./documents";
import { meRoutes } from "./me";
import { publicDocumentsRoutes } from "./public-documents";
import { uploadRoutes, uploadsRoutes } from "./upload";

/** 子应用类型（server 侧固定为 Hono<AppEnv>） */
export type ApiSubApp = Hono<AppEnv>;
export type ApiRouteRegistry = HttpRouteRegistry<ApiSubApp>;

/** 一个路由插件：把自己挂到给定路径 */
function routePlugin(name: string, path: string, app: ApiSubApp): PluginEntry {
  return {
    id: `route-${name}`,
    plugin: {
      name: `route/${name}`,
      inject: ["httpRoutes"],
      apply(ctx: Context) {
        requireHttpRoutes<ApiSubApp>(ctx).route(path, app);
      },
    },
  };
}

/** 内置路由插件清单（顺序即注册顺序） */
export function apiRoutePlugins(): PluginEntry[] {
  return [
    routePlugin("auth", "/auth", authRoutes),
    routePlugin("me", "/me", meRoutes),
    routePlugin("documents", "/documents", documentsRoutes),
    routePlugin("chat-sessions", "/chat/sessions", chatRoutes),
    routePlugin("ai-chat", "/ai/chat", aiChatRoutes),
    routePlugin("ai-undo", "/ai/undo", aiUndoRoutes),
    routePlugin("upload", "/upload", uploadRoutes),
    routePlugin("uploads", "/uploads", uploadsRoutes),
    routePlugin("public-documents", "/public/documents", publicDocumentsRoutes),
  ];
}
