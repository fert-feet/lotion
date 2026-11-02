// plugins 接缝的浏览器实现：把管理操作映射到 /api/plugins/*。
//
// 与 lib/client/doc-store-rest.ts 同构：UI 只依赖接缝契约，不直接写 fetch。
// 注意所有写操作都要求会话 cookie；服务端还会做 owner 判定（双重门禁）。
import type { PluginObject } from "@/lib/kernel";
import {
  providePluginAdmin,
  type ClientPluginConfig,
  type MarketEntry,
  type MarketSourceInfo,
  type PluginAdminService,
  type PluginBundleExport,
  type PluginClientHalf,
  type PluginInfo,
  type PluginSourceCode,
} from "@/lib/seams/plugins";

type FetchImpl = typeof fetch;

interface RequestInitLike {
  method?: string;
  body?: string;
}

async function request<T>(fetchImpl: FetchImpl, path: string, init: RequestInitLike = {}): Promise<T> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (init.body !== undefined) headers["content-type"] = "application/json";

  const res = await fetchImpl(path, {
    method: init.method ?? "GET",
    headers,
    ...(init.body !== undefined ? { body: init.body } : {}),
  });

  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    let code: string | undefined;
    try {
      const body = (await res.json()) as { error?: unknown; code?: unknown };
      if (typeof body.error === "string") message = body.error;
      if (typeof body.code === "string") code = body.code;
    } catch {
      // 非 JSON 错误体：保留 HTTP 状态
    }
    throw new Error(code ? `${message}（${code}）` : message);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const pluginPath = (id: string) => `/api/plugins/${encodeURIComponent(id)}`;

/**
 * 构造 REST 实现。
 * @param fetchImpl - 可注入的 fetch（测试用）；默认全局 fetch
 */
export function createRestPluginAdmin(fetchImpl: FetchImpl = fetch): PluginAdminService {
  return {
    async list() {
      const data = await request<{ plugins: PluginInfo[] }>(fetchImpl, "/api/plugins");
      return data.plugins;
    },
    setEnabled(id, enabled) {
      return request<PluginInfo>(fetchImpl, pluginPath(id), {
        method: "PATCH",
        body: JSON.stringify({ enabled }),
      });
    },
    setConfig(id, config) {
      return request<PluginInfo>(fetchImpl, pluginPath(id), {
        method: "PATCH",
        body: JSON.stringify({ config }),
      });
    },
    approve(id) {
      return request<PluginInfo>(fetchImpl, `${pluginPath(id)}/approve`, { method: "POST" });
    },
    run(id) {
      return request<PluginInfo>(fetchImpl, `${pluginPath(id)}/run`, { method: "POST" });
    },
    stop(id) {
      return request<PluginInfo>(fetchImpl, `${pluginPath(id)}/stop`, { method: "POST" });
    },
    async remove(id) {
      await request<void>(fetchImpl, pluginPath(id), { method: "DELETE" });
    },
    source(id) {
      return request<PluginSourceCode>(fetchImpl, `${pluginPath(id)}/source`);
    },
    async market() {
      const data = await request<{ entries: MarketEntry[] }>(fetchImpl, "/api/plugins/market");
      return data.entries;
    },
    install(id) {
      return request<PluginInfo>(fetchImpl, "/api/plugins/install", {
        method: "POST",
        body: JSON.stringify({ id }),
      });
    },
    installBundle(bundle) {
      return request<PluginInfo>(fetchImpl, "/api/plugins/upload", {
        method: "POST",
        body: JSON.stringify({ bundle }),
      });
    },
    exportPlugin(id) {
      return request<PluginBundleExport>(fetchImpl, `${pluginPath(id)}/export`);
    },
    publishPlugin(id) {
      return request<MarketEntry>(fetchImpl, `${pluginPath(id)}/publish`, { method: "POST" });
    },
    ratePlugin(id, rating, comment) {
      return request<MarketEntry>(fetchImpl, `${pluginPath(id)}/rate`, {
        method: "POST",
        body: JSON.stringify({ rating, ...(comment !== undefined ? { comment } : {}) }),
      });
    },
    getMarketSource() {
      return request<MarketSourceInfo>(fetchImpl, "/api/plugins/market/source");
    },
    setMarketSource(url) {
      return request<MarketSourceInfo>(fetchImpl, "/api/plugins/market/source", {
        method: "PATCH",
        body: JSON.stringify({ url }),
      });
    },
    clientConfig() {
      return request<ClientPluginConfig>(fetchImpl, "/api/plugins/client-config");
    },
    clientHalves() {
      return request<PluginClientHalf[]>(fetchImpl, "/api/plugins/client-halves");
    },
  };
}

/** 装配插件：把 plugins 服务挂到客户端内核 */
export const pluginAdminPlugin: PluginObject = {
  name: "plugin-admin",
  apply(ctx) {
    providePluginAdmin(ctx, createRestPluginAdmin());
  },
};
