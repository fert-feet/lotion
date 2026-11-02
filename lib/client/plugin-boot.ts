// 启动期插件配置读取：在客户端内核装配前拿到 disabled UI 插件 id。
//
// 为什么不能等 React 渲染后再拉：UI 插件的 apply 发生在内核装配时，
// 一旦 AI 面板已经注册进插槽，再拿到 disabled 列表也撤不掉（需要重建内核）。
// 端点公开且只返回 id；失败/超时按"全部启用"处理，不阻塞应用启动。
//
// 带短退避重试：dev 下 Vite 可能先于 API 就绪（详见 lib/client/fetch-retry.ts）。
import { fetchWithRetry } from "./fetch-retry";

export interface FetchDisabledUiPluginsOptions {
  timeoutMs?: number;
  retries?: number;
}

export async function fetchDisabledUiPlugins(
  fetchImpl: typeof fetch = fetch,
  options: FetchDisabledUiPluginsOptions = {},
): Promise<string[]> {
  try {
    const res = await fetchWithRetry(
      "/api/plugins/client-config",
      { cache: "no-store", headers: { accept: "application/json" } },
      {
        fetchImpl,
        timeoutMs: options.timeoutMs ?? 1_500,
        retries: options.retries ?? 5,
        baseDelayMs: 150,
        maxDelayMs: 1_200,
      },
    );
    if (!res.ok) return [];
    const data = (await res.json()) as { disabledUi?: unknown };
    if (!Array.isArray(data.disabledUi)) return [];
    return data.disabledUi.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}
