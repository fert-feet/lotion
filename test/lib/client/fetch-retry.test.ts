// 启动期重试：网络错误/5xx 退避重试；业务响应立即返回。
import { describe, expect, it } from "vitest";
import { fetchWithRetry } from "@/lib/client/fetch-retry";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const fast = { retries: 2, baseDelayMs: 1, maxDelayMs: 2, timeoutMs: 200 };

describe("fetchWithRetry", () => {
  it("成功时只请求一次", async () => {
    let calls = 0;
    const impl = (async () => {
      calls += 1;
      return json({ ok: true });
    }) as typeof fetch;

    const res = await fetchWithRetry("/api/health", {}, { ...fast, fetchImpl: impl });
    expect(res.status).toBe(200);
    expect(calls).toBe(1);
  });

  it("网络错误后重试并成功", async () => {
    let calls = 0;
    const impl = (async () => {
      calls += 1;
      if (calls < 3) throw new Error("ECONNREFUSED");
      return json({ ok: true });
    }) as typeof fetch;

    const res = await fetchWithRetry("/api/health", {}, { ...fast, fetchImpl: impl });
    expect(res.status).toBe(200);
    expect(calls).toBe(3);
  });

  it("503 后重试；401 不重试", async () => {
    let badGateway = 0;
    const gateway = (async () => {
      badGateway += 1;
      return badGateway === 1 ? json({}, 503) : json({ ok: true });
    }) as typeof fetch;
    expect((await fetchWithRetry("/api/x", {}, { ...fast, fetchImpl: gateway })).status).toBe(200);
    expect(badGateway).toBe(2);

    let unauthorized = 0;
    const auth = (async () => {
      unauthorized += 1;
      return json({ error: "Unauthorized" }, 401);
    }) as typeof fetch;
    expect((await fetchWithRetry("/api/me", {}, { ...fast, fetchImpl: auth })).status).toBe(401);
    expect(unauthorized).toBe(1);
  });

  it("超时后抛出（重试次数用尽）", async () => {
    const hanging = (async (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      })) as typeof fetch;

    await expect(
      fetchWithRetry("/api/me", {}, { retries: 1, baseDelayMs: 1, timeoutMs: 5, fetchImpl: hanging }),
    ).rejects.toThrow();
  });
});
