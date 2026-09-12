// remote 的浏览器侧实现：把白名单调用映射到 REST 端点。
//
// 端点映射同样是一张写死的表（与 REMOTE_METHODS 一一对应），
// 新增能力必须同时改：lib/seams/remote.ts 的枚举 + 宿主路由 + 这里的映射。
import { findRemote, provideRemote, type RemoteCall, type RemoteService } from "@/lib/seams/remote";
import type { PluginObject } from "@/lib/kernel";

/** 白名单 (namespace, method) → REST 请求 */
const ENDPOINTS: Record<string, { path: string; query?: (args: unknown) => string }> = {
  "documents.list": { path: "/api/documents", query: () => "?scope=sidebar" },
  "documents.get": {
    path: "/api/documents",
    query: (args) => {
      const id = (args as { id?: string } | undefined)?.id;
      return id ? `/${encodeURIComponent(id)}` : "";
    },
  },
  "chat.sessions": { path: "/api/chat/sessions" },
  "dynamic.plugins": { path: "/api/dynamic/plugins" },
};

/**
 * 构造 remote 实现。
 * @param fetchImpl - 可注入的 fetch（测试用）；默认全局 fetch
 */
export function createRestRemote(fetchImpl: typeof fetch = fetch): RemoteService {
  return {
    async call<T>(call: RemoteCall): Promise<T> {
      const route = ENDPOINTS[`${call.namespace}.${call.method}`];
      if (!route) {
        // 理论上到不了这里（provideRemote 已过白名单），留作映射表漏配的显式兜底
        throw new Error(`[remote] 未映射的调用：${call.namespace}.${call.method}`);
      }
      const suffix = route.query ? route.query(call.args) : "";
      const res = await fetchImpl(`${route.path}${suffix}`, { headers: { accept: "application/json" } });
      if (!res.ok) {
        throw new Error(`[remote] ${call.namespace}.${call.method} 失败：HTTP ${res.status}`);
      }
      return (await res.json()) as T;
    },
  };
}

/** 装配插件：把 remote 服务挂到客户端内核（组合清单里的一行） */
export const remotePlugin: PluginObject = {
  name: "remote",
  apply(ctx) {
    provideRemote(ctx, createRestRemote());
  },
};

/** 动态插件客户端半边能用的 remote（未装配则 undefined） */
export function tryRemote(ctx: Parameters<typeof findRemote>[0]): RemoteService | undefined {
  return findRemote(ctx);
}
