// 启动期插件配置读取：在客户端内核装配前拿到 disabled UI 插件 id。
//
// 为什么不能等 React 渲染后再拉：UI 插件的 apply 发生在内核装配时，
// 一旦 AI 面板已经注册进插槽，再拿到 disabled 列表也撤不掉（需要重建内核）。
// 端点公开且只返回 id；失败/超时一律按"全部启用"处理，不阻塞应用启动。
export async function fetchDisabledUiPlugins(
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 1500,
): Promise<string[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl("/api/plugins/client-config", {
      signal: controller.signal,
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { disabledUi?: unknown };
    if (!Array.isArray(data.disabledUi)) return [];
    return data.disabledUi.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}
