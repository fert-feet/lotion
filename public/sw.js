// Service Worker：让单机自托管的 Lotion 能装成 PWA、并在断网时还能打开外壳。
//
// 策略刻意保守——这个应用的数据全部来自 /api，缓存 API 响应会让"改完看不到"
// 变成玄学：
//   * /api/*        → 永不缓存（直接走网络，失败就失败）
//   * /assets/*     → cache-first（文件名带内容 hash，缓存永远不会过期）
//   * 导航请求      → network-first，失败时回退到缓存的外壳（index.html）
//   * 其他同源 GET  → stale-while-revalidate（字体、图标、市场 registry 等）
//
// 版本号变了会在 activate 时清掉旧缓存；不要在这里做任何数据同步。
const VERSION = "v1";
const ASSETS_CACHE = `lotion-assets-${VERSION}`;
const SHELL_CACHE = `lotion-shell-${VERSION}`;
const RUNTIME_CACHE = `lotion-runtime-${VERSION}`;
const KEEP = new Set([ASSETS_CACHE, SHELL_CACHE, RUNTIME_CACHE]);

/** 安装：预缓存应用外壳（SPA 路由回退用） */
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(["/", "/index.html", "/manifest.webmanifest"])),
  );
  self.skipWaiting();
});

/** 激活：清掉旧版本缓存并立刻接管 */
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => !KEEP.has(n)).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // API 永不缓存：数据一致性优先于离线
  if (url.pathname.startsWith("/api/")) return;

  // 构建产物：cache-first（hash 文件名）
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok) {
          const cache = await caches.open(ASSETS_CACHE);
          cache.put(request, response.clone());
        }
        return response;
      })(),
    );
    return;
  }

  // 导航请求：network-first + 外壳回退（断网时仍能打开应用，/api 会失败但界面在）
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          if (response.ok) {
            const cache = await caches.open(SHELL_CACHE);
            cache.put("/index.html", response.clone());
          }
          return response;
        } catch {
          const cached = (await caches.match("/index.html")) ?? (await caches.match("/"));
          if (cached) return cached;
          throw new Error("offline and no shell cached");
        }
      })(),
    );
    return;
  }

  // 其他同源 GET：stale-while-revalidate
  event.respondWith(
    (async () => {
      const cached = await caches.match(request);
      const network = fetch(request)
        .then(async (response) => {
          if (response.ok) {
            const cache = await caches.open(RUNTIME_CACHE);
            cache.put(request, response.clone());
          }
          return response;
        })
        .catch(() => cached);
      return cached ?? network;
    })(),
  );
});
