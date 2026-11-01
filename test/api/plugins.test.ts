// /api/plugins 单测：owner 门禁、列表/启停/配置、client-config 公开性。
import { describe, it, expect, beforeEach, vi } from "vitest";
import type Database from "better-sqlite3";
import { createRootContext } from "@/lib/kernel";
import { SESSION_COOKIE, createSession, createUser } from "@/lib/local/auth";
import { createPluginManager } from "@/lib/local/plugin-manager";
import type { PluginInfo } from "@/lib/seams/plugins";
import { createApiTestApp } from "../mocks/api-app";
import { createMemoryPluginsSettings } from "../mocks/plugin-settings";

const state = vi.hoisted(() => ({ db: null as Database.Database | null }));

vi.mock("@/lib/local/sqlite", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/local/sqlite")>();
  return { ...actual, getDb: () => state.db! };
});

let app: Awaited<ReturnType<typeof createApiTestApp>>["app"];
let settings: ReturnType<typeof createMemoryPluginsSettings>;
let ownerId: string;
let otherId: string;
let ownerToken: string;
let otherToken: string;

function cookieOf(token: string): Record<string, string> {
  return { cookie: `${SESSION_COOKIE}=${token}` };
}

function get(path: string, token?: string) {
  return app.request(path, { headers: token ? cookieOf(token) : {} });
}

function patch(path: string, body: unknown, token?: string) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) Object.assign(headers, cookieOf(token));
  return app.request(path, { method: "PATCH", headers, body: JSON.stringify(body) });
}

beforeEach(async () => {
  const { initDatabase } = await import("@/lib/local/sqlite");
  const { default: Database } = await import("better-sqlite3");
  const db = new Database(":memory:");
  initDatabase(db);
  state.db = db;

  const owner = createUser(db, "owner@x.com", "password123", "Owner");
  const other = createUser(db, "other@x.com", "password123", "Other");
  // 保证 owner 是"最早注册"（同一毫秒内 createdAt 可能相同，显式拉开）
  db.prepare("UPDATE users SET createdAt = ? WHERE id = ?").run("2020-01-01T00:00:00.000Z", owner.id);
  ownerId = owner.id;
  otherId = other.id;
  ownerToken = createSession(db, owner.id);
  otherToken = createSession(db, other.id);

  settings = createMemoryPluginsSettings();
  const manager = createPluginManager({ ctx: createRootContext(), settings });
  ({ app } = await createApiTestApp([], { pluginAdmin: manager }));
});

describe("GET /api/plugins", () => {
  it("未登录 401；非 owner 403", async () => {
    expect((await get("/api/plugins")).status).toBe(401);

    const forbidden = await get("/api/plugins", otherToken);
    expect(forbidden.status).toBe(403);
    expect((await forbidden.json()).code).toBe("NOT_OWNER");
  });

  it("owner 能拿到列表（含默认关闭的动态通道）", async () => {
    const res = await get("/api/plugins", ownerToken);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { plugins: PluginInfo[] };

    expect(body.plugins.some((item) => item.id === "ui-ai-panel")).toBe(true);
    expect(body.plugins.find((item) => item.id === "dynamic-plugins")).toMatchObject({
      enabled: false,
      core: false,
    });
    expect(body.plugins.find((item) => item.id === "tools-registry")?.core).toBe(true);
  });
});

describe("PATCH /api/plugins/:id", () => {
  it("禁用 UI 插件后 client-config 公开可见", async () => {
    const res = await patch("/api/plugins/ui-ai-panel", { enabled: false }, ownerToken);
    expect(res.status).toBe(200);
    expect((await res.json()).enabled).toBe(false);
    expect(settings.snapshot()["ui-ai-panel"]).toEqual({ disabled: true });

    // client-config 不需要登录（启动期 UI 插件过滤用）
    const config = await get("/api/plugins/client-config");
    expect(config.status).toBe(200);
    expect((await config.json()).disabledUi).toContain("ui-ai-panel");
  });

  it("写入配置并持久到 settings patch", async () => {
    const res = await patch("/api/plugins/route-auth", { config: { label: "登录" } }, ownerToken);
    expect(res.status).toBe(200);
    expect((await res.json()).config).toEqual({ label: "登录" });
    expect(settings.snapshot()["route-auth"]).toEqual({ config: { label: "登录" } });
  });

  it("核心插件不可禁用（409）；未知 id 404；非法 body 400", async () => {
    const core = await patch("/api/plugins/tools-registry", { enabled: false }, ownerToken);
    expect(core.status).toBe(409);
    expect((await core.json()).code).toBe("CORE_PLUGIN");

    expect((await patch("/api/plugins/ghost", { enabled: true }, ownerToken)).status).toBe(404);
    expect((await patch("/api/plugins/ui-ai-panel", {}, ownerToken)).status).toBe(400);
    expect((await patch("/api/plugins/ui-ai-panel", { enabled: "no" }, ownerToken)).status).toBe(400);
  });
});

describe("动态插件端点与 /api/me", () => {
  it("未启用动态通道时 approve 返回 UNSUPPORTED", async () => {
    const res = await app.request("/api/plugins/dyn-1/approve", {
      method: "POST",
      headers: cookieOf(ownerToken),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("UNSUPPORTED");
  });

  it("/api/me 返回 isOwner：最早注册的用户为 true", async () => {
    const owner = await get("/api/me", ownerToken);
    const ownerBody = await owner.json();
    expect(ownerBody.user.id).toBe(ownerId);
    expect(ownerBody.isOwner).toBe(true);

    const other = await get("/api/me", otherToken);
    const otherBody = await other.json();
    expect(otherBody.user.id).toBe(otherId);
    expect(otherBody.isOwner).toBe(false);
  });
});
