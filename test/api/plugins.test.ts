// /api/plugins 单测：owner 门禁、列表/启停/配置、client-config 公开性。
import { describe, it, expect, beforeEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import { createRootContext } from "@/lib/kernel";
import { SESSION_COOKIE, createSession, createUser } from "@/lib/local/auth";
import { createPluginManager } from "@/lib/local/plugin-manager";
import { createDynamicRunner } from "@/lib/dynamic/runner";
import { createFilePluginPackageStore } from "@/lib/local/plugin-package";
import { createPluginMarket } from "@/lib/local/plugin-market";
import type { InstalledPluginRuntime } from "@/lib/local/plugin-runtime";
import type { DynamicPersistence, DynamicRecord } from "@/lib/seams/dynamic";
import type { PluginInfo } from "@/lib/seams/plugins";
import { createApiTestApp } from "../mocks/api-app";
import { createMemoryMarketSettings, createMemoryPluginsSettings } from "../mocks/plugin-settings";

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
  it("未登录 401；任意登录用户权限一致", async () => {
    expect((await get("/api/plugins")).status).toBe(401);

    const other = await get("/api/plugins", otherToken);
    expect(other.status).toBe(200);
    expect((await other.json()).plugins.length).toBeGreaterThan(0);

    const patched = await patch("/api/plugins/ui-ai-panel", { enabled: false }, otherToken);
    expect(patched.status).toBe(200);
    expect((await patched.json()).enabled).toBe(false);
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

  it("市场目录对所有登录用户开放", async () => {
    const res = await get("/api/plugins/market", otherToken);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entries: unknown[] };
    expect(Array.isArray(body.entries)).toBe(true);
    expect((await get("/api/plugins/market")).status).toBe(401);
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

  it("approve 端到端：动态定义进入列表，批准后状态落盘", async () => {
    const records = new Map<string, DynamicRecord>();
    const persistence: DynamicPersistence = {
      load: () => [...records.values()],
      save: (record) => {
        records.set(record.definition.id, {
          definition: record.definition,
          state: record.state,
          ...(record.note ? { note: record.note } : {}),
        });
      },
      remove: (id) => {
        records.delete(id);
      },
    };
    const runner = createDynamicRunner({ ctx: createRootContext(), persistence });
    runner.define({
      title: "客户端插件",
      client: "harness.define({ name: 'demo-client', apply() {} })",
    });

    const manager = createPluginManager({
      ctx: createRootContext(),
      settings: createMemoryPluginsSettings(),
      getDynamic: () => runner,
    });
    const { app: dynamicApp } = await createApiTestApp([], { pluginAdmin: manager });

    const listRes = await dynamicApp.request("/api/plugins", {
      headers: cookieOf(ownerToken),
    });
    const list = (await listRes.json()) as { plugins: PluginInfo[] };
    expect(list.plugins.find((item) => item.id === "dyn-1")).toMatchObject({
      source: "dynamic",
      approved: false,
      status: "stopped",
    });

    const res = await dynamicApp.request("/api/plugins/dyn-1/approve", {
      method: "POST",
      headers: cookieOf(ownerToken),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).approved).toBe(true);
    expect(runner.get("dyn-1")?.state).toBe("approved");
    expect(records.get("dyn-1")?.state).toBe("approved");
  });

  it("市场安装 → 审批 → 启用 → 客户端半边下发", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lotion-installed-api-"));
    try {
      const publicDir = path.join(dir, "public");
      const marketDir = path.join(publicDir, "plugin-market");
      fs.mkdirSync(marketDir, { recursive: true });
      const clientCode =
        "harness.define({ apply: (ctx) => { ctx.get('uiSlots').register({ id: 'quote', slot: 'sidebar.footer.action', kind: 'list', component: harness.createElement('b', null, '✨') }); } });";
      fs.writeFileSync(
        path.join(marketDir, "registry.json"),
        JSON.stringify({
          entries: [
            {
              id: "daily-quote",
              name: "今日一句",
              version: "1.0.0",
              description: "示例",
              bundle: "/plugin-market/daily-quote.json",
            },
          ],
        }),
        "utf-8",
      );
      fs.writeFileSync(
        path.join(marketDir, "daily-quote.json"),
        JSON.stringify({
          id: "daily-quote",
          name: "今日一句",
          version: "1.0.0",
          capabilities: ["ui"],
          client: clientCode,
        }),
        "utf-8",
      );

      const store = createFilePluginPackageStore(path.join(dir, "installed"));
      const runtime: InstalledPluginRuntime = {
        mount: async () => ({ ok: true }),
        unmount: async () => {},
        startAll: async () => {},
        runningIds: () => [],
        error: () => undefined,
        dispose: async () => {},
      };
      const marketSettings = createMemoryMarketSettings();
      const market = createPluginMarket({
        publicDir,
        dataDir: path.join(dir, "data"),
        registryUrl: () => marketSettings.get().registryUrl,
        // 远端源改成 https 后避免真实网络请求：立即失败，market.list 会回退本地
        fetchImpl: (async () => {
          throw new Error("offline");
        }) as typeof fetch,
      });
      const manager = createPluginManager({
        ctx: createRootContext(),
        settings: createMemoryPluginsSettings(),
        marketSettings,
        getPackages: () => store,
        getRuntime: () => runtime,
        market,
      });
      const { app: installedApp } = await createApiTestApp([], { pluginAdmin: manager });
      const auth = { cookie: `${SESSION_COOKIE}=${ownerToken}` };

      const install = await installedApp.request("/api/plugins/install", {
        method: "POST",
        headers: { "content-type": "application/json", ...auth },
        body: JSON.stringify({ id: "daily-quote" }),
      });
      expect(install.status).toBe(200);
      expect(await install.json()).toMatchObject({
        id: "daily-quote",
        source: "installed",
        enabled: false,
        approved: false,
      });

      expect(
        (await installedApp.request("/api/plugins/daily-quote/approve", { method: "POST", headers: auth })).status,
      ).toBe(200);

      const enable = await installedApp.request("/api/plugins/daily-quote", {
        method: "PATCH",
        headers: { "content-type": "application/json", ...auth },
        body: JSON.stringify({ enabled: true }),
      });
      expect(enable.status).toBe(200);
      expect((await enable.json()).enabled).toBe(true);

      const halves = await installedApp.request("/api/plugins/client-halves", { headers: auth });
      expect(halves.status).toBe(200);
      const payload = (await halves.json()) as Array<{ id: string; client: string }>;
      expect(payload).toHaveLength(1);
      expect(payload[0].id).toBe("daily-quote");
      expect(payload[0].client).toContain("harness.define");

      expect((await installedApp.request("/api/plugins/client-halves")).status).toBe(401);

      const catalog = await installedApp.request("/api/plugins/market", { headers: auth });
      const catalogBody = (await catalog.json()) as {
        entries: Array<{ id: string }>;
        source: { remote: boolean };
      };
      expect(catalogBody.entries.some((item) => item.id === "daily-quote")).toBe(true);
      expect(catalogBody.source.remote).toBe(false);

      const source = await installedApp.request("/api/plugins/market/source", {
        method: "PATCH",
        headers: { "content-type": "application/json", ...auth },
        body: JSON.stringify({ url: "https://market.example/registry.json" }),
      });
      expect(source.status).toBe(200);
      expect((await source.json()).url).toBe("https://market.example/registry.json");

      const upload = await installedApp.request("/api/plugins/upload", {
        method: "POST",
        headers: { "content-type": "application/json", ...auth },
        body: JSON.stringify({
          bundle: {
            id: "new-plugin",
            name: "New",
            version: "1.0.0",
            capabilities: ["tools"],
            host: "harness.define({ apply() {} })",
          },
        }),
      });
      expect(upload.status).toBe(200);
      expect(await upload.json()).toMatchObject({ id: "new-plugin", enabled: false });

      const exported = await installedApp.request("/api/plugins/new-plugin/export", {
        headers: auth,
      });
      expect(await exported.json()).toMatchObject({ filename: "new-plugin-1.0.0.json" });

      const published = await installedApp.request("/api/plugins/new-plugin/publish", {
        method: "POST",
        headers: auth,
      });
      expect(published.status).toBe(200);
      expect((await published.json()).bundle).toBe("local:new-plugin");

      const rated = await installedApp.request("/api/plugins/daily-quote/rate", {
        method: "POST",
        headers: { "content-type": "application/json", ...auth },
        body: JSON.stringify({ rating: 5, comment: "好用" }),
      });
      expect(rated.status).toBe(200);
      expect(await rated.json()).toMatchObject({ rating: 5, ratingCount: 1 });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
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
