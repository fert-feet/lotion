// 响应压缩与静态缓存头（可在 createApp 层验证）。
//
// 背景：单机自托管时 Hono 直接托管 dist/ 与 API，此前**完全没有压缩**——
// 6 MB JS 与成片的 JSON 原样裸传。压缩放在 createApp 里（而不是 index.ts），
// 就是为了让这层有测试；静态资源的 immutable 头在 index.ts 的 /assets/* 上。
import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { createApp } from "@/server/app";
import { createHttpRouteRegistry } from "@/lib/seams/http-routes";
import type { ApiSubApp } from "@/server/routes";

/** 构造一个只返回给定 body 的注册表；返回 createApp 装配好的应用 */
function appWith(body: string) {
  const routes = createHttpRouteRegistry<ApiSubApp>(() => "test");
  const sub = new Hono();
  // 子应用挂在 /api/big 下，dispatcher 请求的是子应用的 "/"
  sub.get("/", (c) => c.json({ payload: body }));
  routes.route("/big", sub);
  return createApp(routes);
}

const BIG = "x".repeat(4096);

describe("响应压缩", () => {
  it("Accept-Encoding: gzip 时大响应压缩，并声明 content-encoding", async () => {
    const res = await appWith(BIG).request("/api/big", {
      headers: { "accept-encoding": "gzip" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-encoding")).toBe("gzip");
    // 压缩后字节数应显著小于原文
    const bytes = (await res.arrayBuffer()).byteLength;
    expect(bytes).toBeLessThan(BIG.length);
  });

  it("客户端不支持压缩时不加 content-encoding（响应保持可读）", async () => {
    const res = await appWith(BIG).request("/api/big", { headers: { "accept-encoding": "" } });
    expect(res.headers.get("content-encoding")).toBeNull();
    expect((await res.json()) as { payload: string }).toEqual({ payload: BIG });
  });
});
