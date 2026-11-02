// GET /api/health —— 无鉴权存活探针（dev 启动等待脚本依赖）。
import { describe, expect, it, beforeEach } from "vitest";
import { createApiTestApp } from "../mocks/api-app";

let app: Awaited<ReturnType<typeof createApiTestApp>>["app"];

beforeEach(async () => {
  ({ app } = await createApiTestApp());
});

describe("GET /api/health", () => {
  it("无需登录返回 ok", async () => {
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, service: "lotion" });
  });
});
