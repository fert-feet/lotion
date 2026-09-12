// 事件总线单测：四种分发模式（emit / waterfall / parallel / serial）语义。
import { describe, it, expect, vi } from "vitest";
import { Context, EventBus } from "@/lib/kernel";

// 声明合并：验证领域模块可以不改内核就增补事件（内核的核心扩展点之一）
declare module "@/lib/kernel/events" {
  interface KernelEventMap {
    "test/ping": [n: number];
    "test/guard": [name: string];
  }
}

describe("lib/kernel EventBus", () => {
  it("emit：按注册顺序同步观察，无返回值", () => {
    const bus = new EventBus();
    const seen: number[] = [];
    bus.add(1, "test/ping", ((n: number) => seen.push(n)) as never);
    bus.add(2, "test/ping", ((n: number) => seen.push(n * 10)) as never);

    bus.emit("test/ping", 2);

    expect(seen).toEqual([2, 20]);
  });

  it("waterfall：next() 委托下游并回传返回值，可再生包装", () => {
    const bus = new EventBus();
    bus.add(1, "test/guard", ((name: string, next: (n: string) => string) => `<${next(name)}>`) as never);
    bus.add(2, "test/guard", ((name: string) => `core:${name}`) as never);

    expect(bus.waterfall("test/guard", "x")).toBe("<core:x>");
  });

  it("waterfall：不调用 next 即短路（单决策事件的设计意图）", () => {
    const bus = new EventBus();
    const downstream = vi.fn();
    bus.add(1, "test/guard", ((_n: string) => "denied") as never);
    bus.add(2, "test/guard", ((name: string) => downstream(name)) as never);

    expect(bus.waterfall("test/guard", "x")).toBe("denied");
    expect(downstream).not.toHaveBeenCalled();
  });

  it("waterfall：同层重复调用 next() 抛错（防重复委托）", () => {
    const bus = new EventBus();
    bus.add(
      1,
      "test/guard",
      ((name: string, next: (n: string) => string) => {
        next(name);
        return next(name);
      }) as never,
    );
    bus.add(2, "test/guard", ((name: string) => name) as never);

    expect(() => bus.waterfall("test/guard", "x")).toThrow(/next\(\) 被重复调用/);
  });

  it("parallel：并行扇出并 await 全部完成", async () => {
    const bus = new EventBus();
    const order: string[] = [];
    bus.add(
      1,
      "test/ping",
      (async () => {
        await new Promise((r) => setTimeout(r, 10));
        order.push("slow");
      }) as never,
    );
    bus.add(
      2,
      "test/ping",
      (async () => {
        order.push("fast");
      }) as never,
    );

    await bus.parallel("test/ping", 1);

    expect(order).toEqual(["fast", "slow"]);
  });

  it("serial：按注册顺序串行，返回值透出", async () => {
    const bus = new EventBus();
    bus.add(1, "test/ping", ((n: number) => n + 1) as never);
    bus.add(2, "test/ping", ((n: number) => n * 2) as never);

    // serial 语义：监听器拿到同一份参数，返回最后一个监听器的结果
expect(await bus.serial("test/ping", 3)).toBe(6);
  });

  it("removeOwner：拆卸纤维时只移除它自己的监听器", () => {
    const bus = new EventBus();
    const kept = vi.fn();
    const removed = vi.fn();
    bus.add(1, "test/ping", kept as never);
    bus.add(2, "test/ping", removed as never);

    bus.removeOwner(2);
    bus.emit("test/ping", 1);

    expect(kept).toHaveBeenCalledTimes(1);
    expect(removed).not.toHaveBeenCalled();
    expect(bus.count("test/ping")).toBe(1);
  });
});

describe("lib/kernel 事件与上下文集成", () => {
  it("插件监听器随插件卸载自动移除（可逆副作用）", async () => {
    const ctx = Context.createRoot();
    const hits: number[] = [];
    const fiber = ctx.plugin({
      name: "listener",
      apply: (c) => {
        c.on("test/ping", (n) => hits.push(n));
      },
    });

    ctx.emit("test/ping", 1);
    await fiber.dispose();
    ctx.emit("test/ping", 2);

    expect(hits).toEqual([1]);
    expect(ctx.audit().listeners).toBe(0);
  });

  it("waterfall 可用作工具护栏：类型上就没有 allow 返回域（返回即拒绝）", () => {
    const ctx = Context.createRoot();
    // 守卫：返回字符串 = 拒绝（不可被后续监听器"翻回"允许）
    ctx.plugin({
      name: "guard",
      apply: (c) => {
        c.onWaterfall<"test/guard", string | undefined>("test/guard", (name, next) =>
          name === "删除" ? "需要用户确认" : (next(name) as string | undefined),
        );
      },
    });
    ctx.plugin({
      name: "inner",
      apply: (c) => {
        c.onWaterfall<"test/guard", string | undefined>("test/guard", (name) => `执行:${name}`);
      },
    });

    expect(ctx.waterfall<"test/guard", string | undefined>("test/guard", "删除")).toBe("需要用户确认");
    expect(ctx.waterfall<"test/guard", string | undefined>("test/guard", "读取")).toBe("执行:读取");
  });
});
