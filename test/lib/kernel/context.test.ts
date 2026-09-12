// 内核单测：服务容器 / inject 门控 / 可逆副作用 / 插件生命周期 / 审计。
// 这些用例是后续所有重构的安全网 —— 内核语义被改坏，这里必须先红。
import { describe, it, expect, vi } from "vitest";
import { Context, FiberState, auditOk, formatAudit } from "@/lib/kernel";

/** 测试用插件：记录自己的生命周期调用 */
function makeProbe(name: string) {
  const calls: string[] = [];
  const plugin = {
    name,
    apply(ctx: Context, config?: unknown) {
      calls.push(`apply:${JSON.stringify(config ?? null)}`);
      ctx.effect(() => {
        calls.push(`dispose:${name}`);
      });
      return () => {
        calls.push(`returned-disposer:${name}`);
      };
    },
  };
  return { plugin, calls };
}

describe("lib/kernel 服务容器", () => {
  it("provide/get：按 key 读取服务", () => {
    const ctx = Context.createRoot();
    const service = { hello: () => "world" };
    ctx.provide("greeter", service);

    expect(ctx.get("greeter")).toBe(service);
    expect(ctx.has("greeter")).toBe(true);
    expect(ctx.serviceKeys).toEqual(["greeter"]);
  });

  it("同名二次注册抛错，并指明当前提供方", () => {
    const ctx = Context.createRoot();
    ctx.plugin({ name: "first", apply: (c) => void c.provide("svc", 1) });

    // 同步挂载路径：配置/代码错误当场抛出（装配层需要立刻失败，而不是静默留个坏插件）
    expect(() => ctx.plugin({ name: "second", apply: (c) => void c.provide("svc", 2) })).toThrow(
      /已由插件「first」提供/,
    );
  });

  it("get 对未注册的 key 返回 undefined（可选依赖降级用）", () => {
    const ctx = Context.createRoot();
    expect(ctx.get("nope")).toBeUndefined();
  });

  it("服务随提供方纤维拆卸而消失", async () => {
    const ctx = Context.createRoot();
    const fiber = ctx.plugin({ name: "provider", apply: (c) => void c.provide("svc", 42) });
    expect(ctx.get("svc")).toBe(42);

    await fiber.dispose();
    expect(ctx.get("svc")).toBeUndefined();
  });

  it("服务增删会广播 kernel/service-* 事件", async () => {
    const ctx = Context.createRoot();
    const seen: string[] = [];
    ctx.on("kernel/service-added", (key) => seen.push(`+${key}`));
    ctx.on("kernel/service-removed", (key) => seen.push(`-${key}`));

    const fiber = ctx.plugin({ name: "p", apply: (c) => void c.provide("svc", 1) });
    await fiber.dispose();

    expect(seen).toEqual(["+svc", "-svc"]);
  });
});

describe("lib/kernel inject 门控", () => {
  it("依赖齐备时立即执行", () => {
    const ctx = Context.createRoot();
    ctx.provide("a", 1);
    const spy = vi.fn();

    ctx.inject(["a"], spy);

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("依赖缺失时挂为 PENDING，服务出现后自动激活", () => {
    const ctx = Context.createRoot();
    const spy = vi.fn();
    ctx.inject(["late"], spy);

    expect(spy).not.toHaveBeenCalled();
    expect(ctx.audit().pending.map((p) => p.missing)).toEqual([["late"]]);

    ctx.provide("late", "ready");

    expect(spy).toHaveBeenCalledTimes(1);
    expect(auditOk(ctx.audit())).toBe(true);
  });

  it("依赖消失时回卷已激活的注册并回到 PENDING，再次齐备会重新激活", async () => {
    const ctx = Context.createRoot();
    const events: string[] = [];
    const provider = ctx.plugin({ name: "provider", apply: (c) => void c.provide("svc", 1) });

    ctx.inject(["svc"], () => {
      events.push("activate");
      return () => {
        events.push("rollback");
      };
    });
    expect(events).toEqual(["activate"]);

    await provider.dispose();

    expect(events).toEqual(["activate", "rollback"]);
    expect(ctx.audit().pending.some((p) => p.missing.includes("svc"))).toBe(true);

    // 再次提供 → 重新激活
    ctx.provide("svc", 2);
    expect(events).toEqual(["activate", "rollback", "activate"]);
  });

  it("inject 回调内的注册归属 active 纤维：依赖消失时被回卷（监听器也一并消失）", async () => {
    const ctx = Context.createRoot();
    const provider = ctx.plugin({ name: "provider", apply: (c) => void c.provide("svc", 1) });
    const hits: number[] = [];

    ctx.inject(["svc"], (c) => {
      c.on("kernel/service-added", () => hits.push(1));
    });
    ctx.provide("other", 1);
    expect(hits).toHaveLength(1);

    await provider.dispose();
    ctx.provide("other2", 1); // 回卷后监听器不应再收到事件

    expect(hits).toHaveLength(1);
  });

  it("返回的撤销函数可手动卸载：回调的注册被回卷", () => {
    const ctx = Context.createRoot();
    const events: string[] = [];
    const off = ctx.inject(["a"], () => {
      events.push("activate");
      return () => void events.push("rollback");
    });
    ctx.provide("a", 1);
    expect(events).toEqual(["activate"]);

    off();

    expect(events).toEqual(["activate", "rollback"]);
    expect(ctx.audit().services).toContain("a"); // 服务本身不受影响
  });
});

describe("lib/kernel 插件生命周期", () => {
  it("函数形态与对象形态都能挂载，config 会传给 apply", () => {
    const ctx = Context.createRoot();
    const { plugin, calls } = makeProbe("probe");

    ctx.plugin(plugin, { config: { enabled: true } });
    ctx.plugin((c) => void c.provide("from-function", 1), { name: "fn-plugin" });

    expect(calls).toContain('apply:{"enabled":true}');
    expect(ctx.get("from-function")).toBe(1);
  });

  it("inject 未满足时插件保持 PENDING 且不执行 apply；补齐后激活", () => {
    const ctx = Context.createRoot();
    const apply = vi.fn();
    const fiber = ctx.plugin({ name: "needs-svc", inject: ["svc"], apply });

    expect(apply).not.toHaveBeenCalled();
    expect(fiber.state).toBe(FiberState.PENDING);
    expect(ctx.audit().pending).toEqual([{ name: "needs-svc", missing: ["svc"] }]);

    ctx.provide("svc", 1);

    expect(apply).toHaveBeenCalledTimes(1);
    expect(fiber.state).toBe(FiberState.ACTIVE);
  });

  it("apply 抛错 → fiber FAILED，并进入审计报告（不炸掉宿主）", () => {
    const onError = vi.fn();
    const ctx = Context.createRoot({ onError });
    const fiber = ctx.plugin({
      name: "boom",
      inject: ["svc"],
      apply: () => {
        throw new Error("配置非法");
      },
    });
    ctx.provide("svc", 1);

    expect(fiber.state).toBe(FiberState.FAILED);
    expect(ctx.audit().failed).toEqual([{ name: "boom", error: "配置非法" }]);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("拆卸插件：子纤维先于父、副作用逆序执行", async () => {
    const ctx = Context.createRoot();
    const order: string[] = [];
    const child = ctx.plugin({
      name: "child",
      apply: (c) => {
        c.effect(() => void order.push("child-effect"));
      },
    });
    ctx.plugin({
      name: "parent",
      apply: (c) => {
        c.effect(() => void order.push("parent-first"));
        c.effect(() => void order.push("parent-second"));
        void child;
      },
    });

    await ctx.dispose();

    // 逆序：后注册的先撤；子纤维的注册在父 fiber 之前完成
    expect(order.indexOf("parent-second")).toBeLessThan(order.indexOf("parent-first"));
    expect(order).toContain("child-effect");
  });

  it("fiber 已拆卸后再 effect：立即执行 disposer（不留孤儿注册）", async () => {
    const ctx = Context.createRoot();
    let disposed = 0;
    const fiber = ctx.plugin({
      name: "late",
      apply: (c) => {
        c.effect(() => void (disposed += 1));
      },
    });

    await fiber.dispose();
    ctx.effect(() => void (disposed += 1)); // 根上下文仍活着

    expect(disposed).toBe(1);
  });

  it("异步 apply 返回的 disposer 会在拆卸时等待执行", async () => {
    const ctx = Context.createRoot();
    const events: string[] = [];
    const fiber = ctx.plugin({
      name: "async-plugin",
      apply: async () => {
        events.push("apply");
        return () => {
          events.push("dispose");
        };
      },
    });

    await fiber.dispose();

    expect(events).toEqual(["apply", "dispose"]);
  });
});

describe("lib/kernel audit", () => {
  it("formatAudit 报告 PENDING 缺失服务与失败原因", () => {
    const ctx = Context.createRoot({ onError: () => {} });
    ctx.plugin({ name: "等待型", inject: ["db"], apply: () => {} });
    const failing = ctx.plugin({ name: "失败型", inject: ["db"], apply: () => {} });
    void failing;
    ctx.provide("db", 1);

    const report = ctx.audit();
    expect(auditOk(report)).toBe(true);

    const text = formatAudit(report);
    expect(text).toContain("已装配");
    expect(text).not.toContain("PENDING");
  });

  it("启动审计能把静态缺失暴露出来（inject 静默失败的防线）", () => {
    const ctx = Context.createRoot();
    ctx.plugin({ name: "orphan", inject: ["missing-svc"], apply: () => {} });

    const text = formatAudit(ctx.audit());

    expect(text).toContain("orphan");
    expect(text).toContain("missing-svc");
    expect(auditOk(ctx.audit())).toBe(false);
  });
});
