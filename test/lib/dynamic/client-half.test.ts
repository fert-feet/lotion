// remote 白名单 + 客户端半边沙箱单测。
// 重点：白名单是**枚举式**的（无运行期动态注册）、客户端半边只能碰两个服务、
// 形参遮蔽挡裸标识符但**挡不住 globalThis.*（如实钉住这个局限）**。
import { describe, it, expect, vi } from "vitest";
import { Context } from "@/lib/kernel";
import type { RemoteService } from "@/lib/seams/remote";
import {
  REMOTE_METHODS,
  REMOTE_NAMESPACES,
  REMOTE_SERVICE,
  checkRemoteCall,
  findRemote,
  guardRemote,
  provideRemote,
  requireRemote,
} from "@/lib/seams/remote";
import { createRestRemote, remotePlugin } from "@/lib/client/remote-rest";
import { createUiSlots, provideUiSlots } from "@/lib/seams/ui-slots";
import { createRemoteStub, createSlotsStub } from "@/test/mocks/client-facade";
import { CLIENT_ALLOWED, CLIENT_SHADOWED_GLOBALS, evaluateClientHalf } from "@/lib/dynamic/client-sandbox";

describe("lib/seams/remote 白名单边界", () => {
  it("namespace 与方法都是枚举白名单", () => {
    expect(checkRemoteCall({ namespace: "documents", method: "list" })).toBeNull();
    expect(checkRemoteCall({ namespace: "chat", method: "sessions" })).toBeNull();
    expect(checkRemoteCall({ namespace: "dynamic", method: "plugins" })).toBeNull();
  });

  it("越界 namespace / 方法被拒绝，并列出允许项", () => {
    expect(checkRemoteCall({ namespace: "users", method: "list" })).toContain("不在白名单内");
    expect(checkRemoteCall({ namespace: "documents", method: "delete" })).toContain(
      "允许：list、get",
    );
    expect(checkRemoteCall({ namespace: "", method: "list" })).toContain("不在白名单内");
  });

  it("没有运行期动态注册路径：白名单表是只读常量", () => {
    expect(Object.isFrozen(REMOTE_NAMESPACES)).toBe(false); // 数组本体可变，但没有注册 API
    expect(REMOTE_METHODS.documents).toEqual(["list", "get"]);
    // 唯一"新增能力"的方式是改这张表 + 加宿主路由（代码级变更）
    expect(Object.keys(REMOTE_METHODS).sort()).toEqual(["chat", "documents", "dynamic"]);
  });

  it("provideRemote 会套上白名单（实现方无法绕过）", async () => {
    const ctx = Context.createRoot();
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

    const ctx = Context.createRoot();
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

  it("remotePlugin 挂载后服务就位（客户端内核里的一行）", () => {
    const ctx = Context.createRoot();
    const fiber = ctx.plugin(remotePlugin);

    expect(findRemote(ctx)).toBeDefined();
    void fiber;
  });
});

describe("lib/dynamic/client-sandbox 客户端半边求值", () => {
  it("合法代码交出插件形状；apply 只能用 uiSlots 与 remote", () => {
    const ctx = Context.createRoot();
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

  it("非白名单服务取不到（ctx.get 只放行两个）", () => {
    const ctx = Context.createRoot();
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

  it("被遮蔽的全局名做成陷阱函数（裸标识符拿不到真东西）", () => {
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
        const ctx = Context.createRoot();
        expect(() => result.plugin.apply(ctx)).toThrow(new RegExp(hint));
      }
    }
    expect(CLIENT_SHADOWED_GLOBALS).toContain("fetch");
  });

  it("process / Buffer 是 undefined（不是抛错 getter）", () => {
    const ctx = Context.createRoot();
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

  it("如实钉住局限：globalThis.* 绕过形参遮蔽（所以客户端半边需人工审批）", () => {
    const result = evaluateClientHalf(
      `harness.define({ apply: () => {
         // 形参只遮蔽裸标识符，属性访问依然可达
         globalThis.__dynLeak = typeof globalThis.fetch;
       } });`,
      { id: "dyn-5" },
    );

    expect(result.ok).toBe(true);
    if (result.ok) result.plugin.apply(Context.createRoot());

    expect((globalThis as unknown as { __dynLeak?: string }).__dynLeak).toBe("function");
    delete (globalThis as unknown as { __dynLeak?: string }).__dynLeak;
  });

  it("语法错误 / 没有 define → 可读错误", () => {
    const bad = evaluateClientHalf("harness.define({ apply(){} }); @@@", { id: "dyn-6" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toContain("语法错误");

    const missing = evaluateClientHalf('console.log("忘了 define");', { id: "dyn-7" });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error).toContain("没有调用 harness.define");
  });
});
