// 全局测试环境准备（vitest setupFiles）。
// jsdom 不实现以下浏览器 API，而应用里的 next-themes / 响应式 hook / radix 需要它们。

if (typeof window !== "undefined") {
  // React 18+ 的 act 支持（消除 "not configured to support act(...)" 警告）
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;

  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }

  if (!("ResizeObserver" in globalThis)) {
    class ResizeObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
  }

  if (!window.localStorage) {
    const store = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      value: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, String(v)),
        removeItem: (k: string) => void store.delete(k),
        clear: () => store.clear(),
      },
      configurable: true,
    });
  }
}
