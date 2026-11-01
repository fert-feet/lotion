// 插件管理服务的测试桩：默认全部可调用，按需覆盖。
import { vi } from "vitest";
import type { PluginAdminService } from "@/lib/seams/plugins";

export function createPluginAdminStub(
  overrides: Partial<PluginAdminService> = {},
): PluginAdminService {
  return {
    list: vi.fn(async () => []),
    setEnabled: vi.fn(async () => {
      throw new Error("setEnabled 未打桩");
    }),
    setConfig: vi.fn(async () => {
      throw new Error("setConfig 未打桩");
    }),
    approve: vi.fn(async () => {
      throw new Error("approve 未打桩");
    }),
    run: vi.fn(async () => {
      throw new Error("run 未打桩");
    }),
    stop: vi.fn(async () => {
      throw new Error("stop 未打桩");
    }),
    remove: vi.fn(async () => {}),
    source: vi.fn(async () => ({})),
    market: vi.fn(async () => []),
    install: vi.fn(async () => {
      throw new Error("install 未打桩");
    }),
    clientConfig: vi.fn(async () => ({ disabledUi: [] })),
    clientHalves: vi.fn(async () => []),
    ...overrides,
  };
}
