// 启动期插件配置读取：成功/失败/超时都必须退化为"全部启用"，不能阻塞启动。
import { describe, expect, it } from "vitest";
import { fetchDisabledUiPlugins } from "@/lib/client/plugin-boot";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const noRetry = { retries: 0, timeoutMs: 200 };

describe("fetchDisabledUiPlugins", () => {
  it("读取 disabledUi 并过滤非字符串", async () => {
    const fetchImpl = (async () =>
      json({ disabledUi: ["ui-ai-panel", 42, null] })) as typeof fetch;

    expect(await fetchDisabledUiPlugins(fetchImpl)).toEqual(["ui-ai-panel"]);
  });

  it("非 2xx / 非法形状返回空数组", async () => {
    expect(
      await fetchDisabledUiPlugins((async () => json({}, 503)) as typeof fetch, noRetry),
    ).toEqual([]);
    expect(
      await fetchDisabledUiPlugins((async () => json({ disabledUi: "x" })) as typeof fetch, noRetry),
    ).toEqual([]);
    expect(
      await fetchDisabledUiPlugins((async () => new Response("nope", { status: 200 })) as typeof fetch, noRetry),
    ).toEqual([]);
  });

  it("网络异常与超时都返回空数组", async () => {
    expect(
      await fetchDisabledUiPlugins((async () => {
        throw new Error("offline");
      }) as typeof fetch, noRetry),
    ).toEqual([]);

    const hanging = (async (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      })) as typeof fetch;
    const started = Date.now();
    expect(await fetchDisabledUiPlugins(hanging, { timeoutMs: 10, retries: 0 })).toEqual([]);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("网络抖动后会重试并成功", async () => {
    let calls = 0;
    const flaky = (async () => {
      calls += 1;
      if (calls === 1) throw new Error("ECONNREFUSED");
      return json({ disabledUi: ["ui-ai-panel"] });
    }) as typeof fetch;

    expect(
      await fetchDisabledUiPlugins(flaky, { retries: 2, timeoutMs: 200 }),
    ).toEqual(["ui-ai-panel"]);
    expect(calls).toBe(2);
  });
});
