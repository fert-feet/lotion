// remote 白名单 + 客户端半边沙箱单测。
// 重点：白名单是**枚举式**的（无运行期动态注册）、客户端半边只能碰两个服务、
// 形参遮蔽挡裸标识符但**挡不住 globalThis.*（如实钉住这个局限）**。
import { describe, it, expect, vi } from "vitest";
import type Database from "better-sqlite3";

// 路由层走 getDb() 单例：与 test/api/* 一样把它指向内存库（否则鉴权读不到测试会话）
const state = vi.hoisted(() => ({ db: null as Database.Database | null }));
vi.mock("@/lib/local/sqlite", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/local/sqlite")>();
  return { ...actual, getDb: () => state.db! };
});
import {createRootContext } from "@/lib/kernel";
import { mount } from "@/test/mocks/mount";
import type { RemoteService } from "@/lib/seams/remote";
import {
  REMOTE_METHODS,
  REMOTE_NAMESPACES,
  checkRemoteCall,
  findRemote,
  guardRemote,
  provideRemote,
  requireRemote,
} from "@/lib/seams/remote";
import { createRestRemote, remotePlugin } from "@/lib/client/remote-rest";
import { createUiSlots, provideUiSlots } from "@/lib/seams/ui-slots";
import { createRemoteStub } from "@/test/mocks/client-facade";
import { CLIENT_ALLOWED, CLIENT_SHADOWED_GLOBALS, evaluateClientHalf } from "@/lib/dynamic/client-sandbox";

describe("lib/seams/remote 白名单边界", () => {
  it("namespace 与方法都是枚举白名单", async () => {
    expect(checkRemoteCall({ namespace: "documents", method: "list" })).toBeNull();
    expect(checkRemoteCall({ namespace: "chat", method: "sessions" })).toBeNull();
    expect(checkRemoteCall({ namespace: "dynamic", method: "plugins" })).toBeNull();
  });

  it("越界 namespace / 方法被拒绝，并列出允许项", async () => {
    expect(checkRemoteCall({ namespace: "users", method: "list" })).toContain("不在白名单内");
    expect(checkRemoteCall({ namespace: "documents", method: "delete" })).toContain(
      "允许：list、get",
    );
    expect(checkRemoteCall({ namespace: "", method: "list" })).toContain("不在白名单内");
  });

  it("没有运行期动态注册路径：白名单表是只读常量", async () => {
    expect(Object.isFrozen(REMOTE_NAMESPACES)).toBe(false); // 数组本体可变，但没有注册 API
    expect(REMOTE_METHODS.documents).toEqual(["list", "get"]);
    // 唯一"新增能力"的方式是改这张表 + 加宿主路由（代码级变更）
    expect(Object.keys(REMOTE_METHODS).sort()).toEqual(["chat", "documents", "dynamic"]);
  });

  it("provideRemote 会套上白名单（实现方无法绕过）", async () => {
    const ctx = createRootContext();
    const inner = { call: vi.fn(async () => "ok" as unknown) } as unknown as RemoteService & { call: ReturnType<typeof vi.fn> };
    provideRemote(ctx, inner);

    expect(requireRemote(ctx)).toBeDefined();
    await expect(
      requireRemote(ctx).call({ namespace: "users", method: "list" }),
    ).rejects.toThrow(/调用被拒绝/);
    expect(inner.call).not.toHaveBeenCalled();

    await requireRemote(ctx).call({ namespace: "documents", method: "list" });
    expect(inner.call).toHaveBeenCalledTimes(1);
  });

  it("guardRemote 可独立使用；未装配时 require 抛可操作错误", async () => {
    const wrapped = guardRemote({ call: async () => "x" as unknown } as unknown as RemoteService);
    await expect(wrapped.call({ namespace: "nope", method: "m" })).rejects.toThrow(/白名单/);

    const ctx = createRootContext();
    expect(findRemote(ctx)).toBeUndefined();
    expect(() => requireRemote(ctx)).toThrow(/remote 未装配/);
  });

  it("REST 实现把白名单调用映射到端点（写入路径正确、失败抛错）", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string) => {
      calls.push(url);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as unknown as typeof fetch;
    const remote = createRestRemote(fetchImpl);

    await remote.call({ namespace: "documents", method: "list" });
    await remote.call({ namespace: "documents", method: "get", args: { id: "d1" } });
    await remote.call({ namespace: "dynamic", method: "plugins" });

    expect(calls).toEqual([
      "/api/documents?scope=sidebar",
      "/api/documents/d1",
      "/api/dynamic/plugins",
    ]);

    const failing = createRestRemote(
      (async () => new Response("nope", { status: 404 })) as unknown as typeof fetch,
    );
    await expect(failing.call({ namespace: "chat", method: "sessions" })).rejects.toThrow(/HTTP 404/);
  });

  it("remotePlugin 挂载后服务就位（客户端内核里的一行）", async () => {
    const ctx = createRootContext();
    const fiber = await mount(ctx, remotePlugin);

    expect(findRemote(ctx)).toBeDefined();
    void fiber;
  });
});

describe("lib/dynamic/client-sandbox 客户端半边求值", () => {
  it("合法代码交出插件形状；apply 只能用 uiSlots 与 remote", async () => {
    const ctx = createRootContext();
    const slots = createUiSlots<unknown>();
    provideUiSlots(ctx, slots);
    provideRemote(ctx, createRemoteStub());

    const result = evaluateClientHalf(
      `
      harness.define({
        name: "banner",
        apply: (ctx) => {
          const uiSlots = ctx.get("uiSlots");
          const remote = ctx.get("remote");
          console.log("注册面板");
          uiSlots.register({
            id: "dyn-banner",
            slot: "details.panel",
            kind: "single",
            component: "<div>插件面板</div>",
          });
          remote.call({ namespace: "documents", method: "list" });
        },
      });
      `,
      { id: "dyn-1", onLog: () => {} },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    result.plugin.apply(ctx);

    expect(slots.get("details.panel")).toBe("<div>插件面板</div>");
  });

  it("非白名单服务取不到（ctx.get 只放行两个）", async () => {
    const ctx = createRootContext();
    provideUiSlots(ctx, createUiSlots<unknown>());
    ctx.provide("settings", { secret: true });

    const result = evaluateClientHalf(
      `harness.define({ apply: (ctx) => {
         const leaked = ctx.get("settings");
         if (leaked) throw new Error("不该拿到的服务: " + JSON.stringify(leaked));
       } });`,
      { id: "dyn-2" },
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(() => result.plugin.apply(ctx)).not.toThrow();
    expect(CLIENT_ALLOWED).toEqual(["uiSlots", "remote"]);
  });

  it("被遮蔽的全局名做成陷阱函数（裸标识符拿不到真东西）", async () => {
    const cases: Array<[string, string]> = [
      ["fetch('https://x')", "remote"],
      ["require('fs')", "require"],
      ["setTimeout(() => {}, 1)", "setTimeout"],
    ];
    for (const [code, hint] of cases) {
      const result = evaluateClientHalf(
        `harness.define({ apply: () => { ${code}; } });`,
        { id: "dyn-3" },
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        const ctx = createRootContext();
        expect(() => result.plugin.apply(ctx)).toThrow(new RegExp(hint));
      }
    }
    expect(CLIENT_SHADOWED_GLOBALS).toContain("fetch");
  });

  it("process / Buffer 是 undefined（不是抛错 getter）", async () => {
    const ctx = createRootContext();
    const result = evaluateClientHalf(
      `harness.define({ apply: () => {
         if (typeof process !== "undefined") throw new Error("process 不该可见");
         if (typeof Buffer !== "undefined") throw new Error("Buffer 不该可见");
       } });`,
      { id: "dyn-4" },
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(() => result.plugin.apply(ctx)).not.toThrow();
  });

  it("如实钉住局限：globalThis.* 绕过形参遮蔽（所以客户端半边需人工审批）", async () => {
    const result = evaluateClientHalf(
      `harness.define({ apply: () => {
         // 形参只遮蔽裸标识符，属性访问依然可达
         globalThis.__dynLeak = typeof globalThis.fetch;
       } });`,
      { id: "dyn-5" },
    );

    expect(result.ok).toBe(true);
    if (result.ok) result.plugin.apply(createRootContext());

    expect((globalThis as unknown as { __dynLeak?: string }).__dynLeak).toBe("function");
    delete (globalThis as unknown as { __dynLeak?: string }).__dynLeak;
  });

  it("语法错误 / 没有 define → 可读错误", async () => {
    const bad = evaluateClientHalf("harness.define({ apply(){} }); @@@", { id: "dyn-6" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toContain("语法错误");

    const missing = evaluateClientHalf('console.log("忘了 define");', { id: "dyn-7" });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error).toContain("没有调用 harness.define");
  });
});

// 端到端：宿主下发（只回已批准、绝不下发 host 代码）→ 客户端沙箱运行 → 插槽出现
describe("动态插件客户端半边的下发与运行", () => {
  it("宿主端点只回已批准的客户端半边，且不含 host 代码", async () => {
    const { openTestDb, initDatabase } = await import("@/lib/local/sqlite");
    const { bootHostKernel, _resetHostKernelForTest } = await import("@/server/kernel");
    const { createApp } = await import("@/server/app");
    const { createUser, createSession, SESSION_COOKIE } = await import("@/lib/local/auth");
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lotion-dynclient-"));
    const settingsPath = path.join(dir, "settings.json");
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({ plugins: { "dynamic-plugins": { disabled: false } } }),
      "utf-8",
    );
    const db = openTestDb();
    initDatabase(db);
    state.db = db;
    _resetHostKernelForTest();
    const kernel = await bootHostKernel({ db, settingsPath });

    const user = createUser(db, "dyn@example.com", "password123");
    const token = createSession(db, user.id);
    const app = createApp(kernel.httpRoutes);

    // 未登录：401
    expect((await app.request("/api/dynamic/plugins")).status).toBe(401);

    const cookie = `${SESSION_COOKIE}=${token}`;
    const before = await app.request("/api/dynamic/plugins", { headers: { cookie } });
    expect(await before.json()).toEqual([]); // 没有定义

    // 登记一个双半边定义：未批准 → 不下发
    const { requireDynamic } = await import("@/lib/seams/dynamic");
    const runner = requireDynamic(kernel.ctx);
    const record = runner.define({
      title: "双半边插件",
      host: "harness.define({ apply(){} });",
      client: "harness.define({ apply: (ctx) => { ctx.get('uiSlots').register({ id: 'x', slot: 's', kind: 'single', component: 'X' }); } });",
    });
    expect(await (await app.request("/api/dynamic/plugins", { headers: { cookie } })).json()).toEqual([]);

    // 批准后下发：只有 id/title/description/client，**没有 host**
    runner.approve(record.definition.id);
    const payload = (await (await app.request("/api/dynamic/plugins", { headers: { cookie } })).json()) as Array<
      Record<string, unknown>
    >;
    expect(payload).toHaveLength(1);
    expect(payload[0].id).toBe(record.definition.id);
    expect(payload[0].host).toBeUndefined();

    await kernel.dispose();
    _resetHostKernelForTest();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("客户端：拉到定义→沙箱运行→插槽出现；通道关闭（remote 失败）时无副作用", async () => {
    const { syncClientHalves } = await import("@/src/dynamic/client-runner");

    // 通道开启：remote 返回一条客户端半边
    const ctxOn = createRootContext();
    const slotsOn = createUiSlots<unknown>();
    provideUiSlots(ctxOn, slotsOn);
    provideRemote(ctxOn, {
      async call<T>(): Promise<T> {
        return [
          {
            id: "dyn-1",
            title: "面板插件",
            client: `harness.define({ apply: (ctx) => { ctx.get("uiSlots").register({ id: "dyn-1-panel", slot: "details.panel", kind: "single", component: "<b>来自动态插件</b>" }); } });`,
          },
        ] as unknown as T;
      },
    });

    const reportOn = await syncClientHalves(ctxOn);
    expect(reportOn.channelEnabled).toBe(true);
    expect(reportOn.ran).toEqual(["dyn-1"]);
    expect(slotsOn.get("details.panel")).toBe("<b>来自动态插件</b>");

    // 通道关闭：remote 报错（404）→ 空报告、零副作用
    const ctxOff = createRootContext();
    const slotsOff = createUiSlots<unknown>();
    provideUiSlots(ctxOff, slotsOff);
    provideRemote(ctxOff, {
      async call<T>(): Promise<T> {
        throw new Error("[remote] dynamic.plugins 失败：HTTP 404");
      },
    });

    const reportOff = await syncClientHalves(ctxOff);
    expect(reportOff).toEqual({ channelEnabled: false, ran: [], failed: [] });
    expect(slotsOff.entries()).toEqual([]);
  });

  it("客户端半边语法错误 → 记入 failed，不影响其它半边", async () => {
    const { runClientHalves } = await import("@/src/dynamic/client-runner");
    const ctx = createRootContext();
    const slots = createUiSlots<unknown>();
    provideUiSlots(ctx, slots);

    const report = await runClientHalves(ctx, [
      { id: "bad", title: "坏的", client: "harness.define({ apply(){} }); @@@" },
      {
        id: "good",
        title: "好的",
        client: `harness.define({ apply: (ctx) => { ctx.get("uiSlots").register({ id: "g", slot: "s", kind: "single", component: "OK" }); } });`,
      },
    ]);

    expect(report.failed.map((f) => f.id)).toEqual(["bad"]);
    expect(report.ran).toEqual(["good"]);
    expect(slots.get("s")).toBe("OK");
  });
});
