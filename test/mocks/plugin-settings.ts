// 测试用：内存版 `plugins` 配置命名空间。
// 真实实现写 data/settings.json；插件管理器测试只需要 get/set 语义。
import type { MarketSettings, PluginsSettings } from "@/lib/local/lotion-config";
import type { SettingsSection } from "@/lib/seams/settings";

export function createMemoryPluginsSettings(initial: PluginsSettings = {}): SettingsSection<PluginsSettings> & {
  snapshot: () => PluginsSettings;
} {
  let value: PluginsSettings = { ...initial };
  const listeners = new Set<(next: PluginsSettings) => void>();

  return {
    namespace: "plugins",
    get: () => value,
    async set(patch) {
      value = { ...value, ...patch } as PluginsSettings;
      for (const listener of [...listeners]) listener(value);
    },
    onChange(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      listeners.clear();
    },
    snapshot: () => value,
  };
}

/** 内存版 `market` 配置命名空间（远端 URL / 验签开关） */
export function createMemoryMarketSettings(
  initial: MarketSettings = { registryUrl: "", requireSignature: false },
): SettingsSection<MarketSettings> & { snapshot: () => MarketSettings } {
  let value: MarketSettings = { ...initial };
  return {
    namespace: "market",
    get: () => value,
    async set(patch) {
      value = { ...value, ...patch };
    },
    onChange() {
      return () => {};
    },
    dispose() {},
    snapshot: () => value,
  };
}
