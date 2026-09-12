// 尖刺：用**真实 Cordis**（@deepseek-ai/cordis 4.0.2）验证我们依赖的语义是否成立。
// 这个文件是迁移决策的证据：只有下面每条都过，才把 lib/kernel 换成适配层。
import { describe, it, expect, vi } from "vitest";
import { Context, Service, type Fiber } from "@deepseek-ai/cordis";

// 声明合并：向 Cordis 的事件表登记尖刺用的事件（顺带验证"插件不改内核即可加事件"）
declare module "@deepseek-ai/cordis" {
  interface Events {
    "demo/event": (value: string) => void;
    "demo/guard": (name: string, next: (value: string) => string) => string;
  }
}

/** Cordis 的 FiberState 是 const enum（运行时被擦除），按源码顺序自己定义常量 */
const FiberState = { PENDING: 0, LOADING: 1, ACTIVE: 2, FAILED: 3, DISPOSED: 4, UNLOADING: 5 } as const;

/**
 * ⚠️ 与自研内核最大的语义差异：**Cordis 的插件激活是异步的**。
 * `ctx.plugin()` 只启动加载（state=LOADING，inertia 是进行中的 Promise），
 * 必须 `await fiber.inertia` 才算真正 ACTIVE —— 迁移时装配与测试都要 settle。
 */
async function settle(fiber: Fiber): Promise<Fiber> {
  let guard = 0;
  while (fiber.inertia && guard++ < 20) await fiber.inertia;
  return fiber;
}

describe("cordis 尖刺：我们依赖的语义", () => {
  it("根上下文：new Context() 即可，根 fiber 为 ACTIVE", () => {
    const ctx = new Context();

    expect(ctx.fiber.state).toBe(FiberState.ACTIVE);
    expect(ctx.fiber.uid).toBe(0); // 根 fiber 的 uid 是 0（不是 null）
  });

  it("provide/get：服务按名注册，同名二次注册抛错", () => {
    const ctx = new Context();
    const service = { hello: () => "world" };
    ctx.provide("greeter", service);

    expect(ctx.get("greeter")).toBe(service);
    expect(() => ctx.provide("greeter", {})).toThrow();
  });

  it("plugin + inject 门控：依赖未就绪时 apply 不执行，就绪后自动激活", async () => {
    const ctx = new Context();
    const apply = vi.fn();

    const fiber = await settle(ctx.plugin({ name: "consumer", inject: ["svc"], apply }));

    expect(apply).not.toHaveBeenCalled();
    expect(fiber.state).toBe(FiberState.PENDING); // 缺依赖 → 停在 PENDING

    ctx.provide("svc", 1);
    await settle(fiber);

    expect(apply).toHaveBeenCalledTimes(1);
    expect(fiber.state).toBe(FiberState.ACTIVE);
  });

  it("effect：回调立即执行并返回 disposer，卸载时调用（Cordis 语义）", async () => {
    const ctx = new Context();
    const events: string[] = [];
    const fiber = await settle(
      ctx.plugin({
        name: "p",
        apply: (c) => {
          // ⚠️ Cordis 的 effect：回调**立即执行**并返回 disposer（与自研内核"回调即 disposer"相反）
          c.effect(() => {
            events.push("setup");
            return () => {
              events.push("disposed");
            };
          });
        },
      }),
    );

    await fiber.dispose();

    expect(events).toEqual(["setup", "disposed"]);
  });

  it("Service 子类：super(ctx, name) 即注册，随 fiber 卸载注销", async () => {
    class Demo extends Service {
      constructor(ctx: Context) {
        super(ctx, "demo");
      }
      hello() {
        return "hi";
      }
    }

    const ctx = new Context();
    const fiber = await settle(ctx.plugin({ name: "demo-provider", apply: (c) => void new Demo(c) }));

    expect((ctx.get("demo") as Demo | undefined)?.hello()).toBe("hi");

    await fiber.dispose();

    expect(ctx.get("demo")).toBeUndefined();
  });

  it("事件：emit 观察 / waterfall 环绕中间件（守卫语义：返回即短路）", async () => {
    const ctx = new Context();
    const seen: string[] = [];

    await settle(
      ctx.plugin({
        name: "listener",
        apply: (c) => {
          c.on("demo/event", (value) => { seen.push(value) });
        },
      }),
    );
    ctx.emit("demo/event", "x");

    expect(seen).toEqual(["x"]);

    // waterfall：监听器收到 (…args, next)，不调用 next 即短路
    await settle(
      ctx.plugin({
        name: "guard",
        apply: (c) => {
          c.on("demo/guard", (name, next) => (name === "删除" ? "需要确认" : next(name)));
        },
      }),
    );
    await settle(
      ctx.plugin({
        name: "inner",
        apply: (c) => {
          c.on("demo/guard", (name) => `执行:${name}`);
        },
      }),
    );

    // ⚠️ Cordis 的 waterfall 由**调用方**传入最内层 next（与自研内核不同：那边是隐式链尾）
    const terminal = (value: string) => `TERMINAL:${value}`;
    expect(ctx.waterfall("demo/guard", "删除", terminal)).toBe("需要确认");
    expect(ctx.waterfall("demo/guard", "读取", terminal)).toBe("执行:读取");
    // 不传 terminal 时最内层监听器的 next 不是函数（会抛错）——如实记录这个约束
    expect(() => (ctx.waterfall as unknown as (n: string, v: string) => string)("demo/guard", "读取")).toThrow(
      /next is not a function/,
    );
  });

  it("registry：能遍历 fiber 与状态（审计的数据来源）", () => {
    const ctx = new Context();
    ctx.plugin({ name: "waiter", inject: ["missing-svc"], apply: () => {} });

    const pending: string[] = [];
    for (const runtime of ctx.registry.values()) {
      for (const fiber of runtime.fibers) {
        if (fiber.state === FiberState.PENDING) pending.push(fiber.name);
      }
    }

    expect(pending.length).toBeGreaterThan(0);
    expect(ctx.get("missing-svc")).toBeUndefined();
  });

  it("isolate：同名服务可在隔离域里各有一份", () => {
    const ctx = new Context();
    ctx.provide("svc", "root");
    const isolated = ctx.isolate("svc");

    isolated.provide("svc", "isolated");

    expect(ctx.get("svc")).toBe("root");
    expect(isolated.get("svc")).toBe("isolated");
  });
});
