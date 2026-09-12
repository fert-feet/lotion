// uiSlots 接缝单测：两种 kind / 排序 / 重复冲突就地失败 / 订阅版本号 / 依赖门控。
import { describe, it, expect, vi } from "vitest";
import { Context, createRootContext, audit, settleAll } from "@/lib/kernel";
import { mount } from "@/test/mocks/mount";
import {
  UI_SLOTS_SERVICE,
  createUiSlots,
  findUiSlots,
  provideUiSlots,
  requireUiSlots,
} from "@/lib/seams/ui-slots";

/** 用字符串当"组件"（接缝对渲染技术无感知） */
type C = string;

describe("lib/seams/ui-slots 注册表", () => {
  it("single 槽：取唯一贡献者", async () => {
    const slots = createUiSlots<C>();
    slots.register({ id: "ai-panel", slot: "details.panel", kind: "single", component: "AI 面板" });

    expect(slots.get("details.panel")).toBe("AI 面板");
    expect(slots.get("nope")).toBeUndefined();
  });

  it("single 槽重复注册抛错（一个位置一个所有者）", async () => {
    const slots = createUiSlots<C>();
    slots.register({ id: "a", slot: "details.panel", kind: "single", component: "A" });

    expect(() =>
      slots.register({ id: "b", slot: "details.panel", kind: "single", component: "B" }),
    ).toThrow(/single 槽「details.panel」已有贡献者「a」/);
  });

  it("贡献 id 重复抛错（跨槽也不能重）", async () => {
    const slots = createUiSlots<C>();
    slots.register({ id: "dup", slot: "s1", kind: "list", component: "A" });

    expect(() => slots.register({ id: "dup", slot: "s2", kind: "list", component: "B" })).toThrow(
      /贡献 id「dup」重复/,
    );
  });

  it("缺 id / 缺 slot 抛错", async () => {
    const slots = createUiSlots<C>();
    expect(() => slots.register({ id: "", slot: "s", kind: "list", component: "A" })).toThrow(
      /必须带 id 与 slot/,
    );
  });

  it("list 槽按 order 升序（相同 order 保持注册顺序）", async () => {
    const slots = createUiSlots<C>();
    slots.register({ id: "b", slot: "toolbar", kind: "list", component: "B", order: 10 });
    slots.register({ id: "a", slot: "toolbar", kind: "list", component: "A" });
    slots.register({ id: "c", slot: "toolbar", kind: "list", component: "C", order: 10 });

    expect(slots.list("toolbar")).toEqual(["A", "B", "C"]);
  });

  it("list 槽只返回该槽的贡献（与 single 槽互不干扰）", async () => {
    const slots = createUiSlots<C>();
    slots.register({ id: "s", slot: "details.panel", kind: "single", component: "PANEL" });
    slots.register({ id: "t", slot: "toolbar", kind: "list", component: "BTN" });

    expect(slots.list("details.panel")).toEqual([]);
    expect(slots.get("toolbar")).toBeUndefined();
    expect(slots.entries()).toHaveLength(2);
  });

  it("订阅：register 后通知监听者，版本号自增（供 useSyncExternalStore 用）", async () => {
    const slots = createUiSlots<C>();
    const listener = vi.fn();
    const off = slots.subscribe(listener);
    const before = slots.version();

    slots.register({ id: "x", slot: "s", kind: "list", component: "X" });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(slots.version()).toBe(before + 1);

    off();
    slots.register({ id: "y", slot: "s", kind: "list", component: "Y" });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("lib/seams/ui-slots 装配", () => {
  it("未装配时 require 抛可操作错误、find 返回 undefined", async () => {
    const ctx = createRootContext();
    expect(findUiSlots(ctx)).toBeUndefined();
    expect(() => requireUiSlots(ctx)).toThrow(/uiSlots 未装配/);
    expect(audit(ctx).services).not.toContain(UI_SLOTS_SERVICE);
  });

  it("装配后按契约读取；实现不完整就地抛错", async () => {
    const ctx = createRootContext();
    provideUiSlots(ctx, createUiSlots<C>());
    expect(requireUiSlots<C>(ctx)).toBeDefined();

    expect(() => provideUiSlots(createRootContext(), {} as never)).toThrow(/实现不完整/);
  });

  it("UI 插件可用 inject 门控等待 uiSlots 就绪后注册贡献", async () => {
    const ctx = createRootContext();
    const slots = createUiSlots<C>();
    const registered: string[] = [];

    await mount(ctx, {
      name: "ui-plugin",
      inject: [UI_SLOTS_SERVICE],
      apply: (c: Context) => {
        requireUiSlots<C>(c).register({ id: "p1", slot: "toolbar", kind: "list", component: "P1" });
        registered.push("p1");
      },
    });
    expect(registered).toEqual([]);
    expect(audit(ctx).pending).toEqual([{ name: "ui-plugin", missing: [UI_SLOTS_SERVICE] }]);

    provideUiSlots(ctx, slots);
    await settleAll(ctx); // Cordis 的 inject 门控在微任务后激活

    expect(registered).toEqual(["p1"]);
    expect(slots.list("toolbar")).toEqual(["P1"]);
  });

  it("服务消失时贡献随插件回滚（注册表仍是干净的）", async () => {
    const ctx = createRootContext();
    const slots = createUiSlots<C>();
    const fiber = await mount(ctx, {
      name: "provider",
      apply: (c: Context) => provideUiSlots(c, slots),
    });
    expect(requireUiSlots<C>(ctx)).toBeDefined();

    await fiber.dispose();

    expect(findUiSlots(ctx)).toBeUndefined();
    // 注册表对象本身被卸载方丢弃（新一次装配会拿到全新的空表）
    expect(slots.list("toolbar")).toEqual([]);
  });
});
