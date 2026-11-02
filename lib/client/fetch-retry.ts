// 带重试的 fetch：只用于**启动期**的只读请求（health / me / client-config）。
//
// 背景：`pnpm dev` 下 Vite 比 API 先就绪，浏览器会在 API ready 前发请求；一次失败就
// 永久停在未登录态（/api/me）或默认全启用（client-config）。这里对网络错误与 5xx
// 做短退避重试；401/403/404 等业务响应立即返回，不重试。
export interface FetchRetryOptions {
  fetchImpl?: typeof fetch;
  retries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** 单次请求超时（毫秒） */
  timeoutMs?: number;
}

export async function fetchWithRetry(
  input: RequestInfo | URL,
  init: RequestInit = {},
  options: FetchRetryOptions = {},
): Promise<Response> {
  const impl = options.fetchImpl ?? fetch;
  const retries = options.retries ?? 4;
  const baseDelayMs = options.baseDelayMs ?? 200;
  const maxDelayMs = options.maxDelayMs ?? 2_000;
  const timeoutMs = options.timeoutMs ?? 2_000;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await impl(input, { ...init, signal: controller.signal });
      // 5xx 通常意味着 API 还在启动/重启（Vite 代理失败也会回 500）：重试
      if (response.status >= 500 && response.status <= 504 && attempt < retries) {
        await sleep(delayOf(attempt, baseDelayMs, maxDelayMs));
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < retries) await sleep(delayOf(attempt, baseDelayMs, maxDelayMs));
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("网络请求失败");
}

function delayOf(attempt: number, base: number, max: number): number {
  return Math.min(max, base * 2 ** attempt);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
