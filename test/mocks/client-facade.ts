// 客户端侧测试桩：remote / uiSlots 的假实现（多个用例共用）。
import { createUiSlots, type UiSlots } from "@/lib/seams/ui-slots";
import type { RemoteService } from "@/lib/seams/remote";

/** 记录所有调用的 remote 假实现（白名单由 provideRemote 统一套上） */
export function createRemoteStub(): RemoteService & { calls: Array<{ namespace: string; method: string }> } {
  const calls: Array<{ namespace: string; method: string }> = [];
  return {
    calls,
    async call<T>(call: { namespace: string; method: string }): Promise<T> {
      calls.push({ namespace: call.namespace, method: call.method });
      return {} as T;
    },
  };
}

/** 空的插槽注册表 */
export function createSlotsStub(): UiSlots<unknown> {
  return createUiSlots<unknown>();
}
