// 启动期插件配置读取：成功/失败/超时都必须退化为"全部启用"，不能阻塞启动。
import { describe, expect, it } from "vitest";
import { fetchDisabledUiPlugins } from "@/lib/client/plugin-boot";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("fetchDisabledUiPlugins", () => {
  it("读取 disabledUi 并过滤非字符串", async () => {
    const fetchImpl = (async () =>
      json({ disabledUi: ["ui-ai-panel", 42, null] })) as typeof fetch;

    expect(await fetchDisabledUiPlugins(fetchImpl)).toEqual(["ui-ai-panel"]);
  });

  it("非 2xx / 非法形状返回空数组", async () => {
    expect(await fetchDisabledUiPlugins((async () => json({}, 503)) as typeof fetch)).toEqual([]);
    expect(await fetchDisabledUiPlugins((async () => json({ disabledUi: "x" })) as typeof fetch)).toEqual([]);
    expect(await fetchDisabledUiPlugins((async () => new Response("nope", { status: 200 })) as typeof fetch)).toEqual([]);
  });

  it("网络异常与超时都返回空数组", async () => {
    expect(
      await fetchDisabledUiPlugins((async () => {
        throw new Error("offline");
      }) as typeof fetch),
    ).toEqual([]);

    const hanging = (async (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      })) as typeof fetch;
    const started = Date.now();
    expect(await fetchDisabledUiPlugins(hanging, 10)).toEqual([]);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
