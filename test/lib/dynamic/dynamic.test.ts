// 动态插件沙箱与 runner 单测。
// 重点不只是"能跑"，而是把**边界如实钉住**：教学式陷阱、process/Buffer 保持 undefined、
// 超时只约束同步部分、服务白名单、卸载后静默。
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Context, createRootContext } from "@/lib/kernel";
import { mount } from "@/test/mocks/mount";
import { createToolRegistry, provideTools, requireTools } from "@/lib/seams/tools";
import type { AnyTool } from "@/lib/ai/tools/registry";
import { evaluateHostHalf, SANDBOX_GLOBALS } from "@/lib/dynamic/sandbox";
import { createDynamicRunner } from "@/lib/dynamic/runner";
import { findDynamic, provideDynamic, requireDynamic } from "@/lib/seams/dynamic";

/** 一段合法的宿主半边代码：注册一个假工具 */
const GOOD_CODE = `
harness.define({
  name: "demo",
  inject: ["tools"],
  apply: (ctx) => {
    console.log("hello from sandbox");
    const tools = ctx.get("tools");
    tools.register({
      name: "ping",
      label: "Ping",
      icon: "🏓",
      description: "沙箱注册的工具",
      create: function () {
        return { description: "ping", inputSchema: {}, execute: async () => "pong" };
      },
    });
  },
});
`;

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("lib/dynamic/sandbox 宿主半边求值", () => {
  it("合法代码交出插件形状（name/inject/apply）", async () => {
    const result = await evaluateHostHalf(GOOD_CODE, { id: "dyn-1" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plugin.name).toBe("demo");
    expect(result.plugin.inject).toEqual(["tools"]);
    expect(typeof result.plugin.apply).toBe("function");
  });

  it("console 带 [plugin:<id>] tag 写透到宿主（挂载后才触发的日志也有落点）", async () => {
    const logs: string[] = [];
    const result = await evaluateHostHalf('harness.define({ apply: (ctx) => { ctx.effect(() => {}); console.warn("later"); } });', {
      id: "dyn-7",
      onLog: (level, message) => logs.push(`${level}:${message}`),
    });

    expect(result.ok).toBe(true);
    // 求值期没有日志（apply 未执行），需要真实挂载才会打印 → 这里直接调用 apply
    if (result.ok) result.plugin.apply(createRootContext());

    expect(logs).toEqual(["warn:[plugin:dyn-7] later"]);
  });

  it("没有调用 harness.define → 明确报错（并给出正确写法）", async () => {
    const result = await evaluateHostHalf('console.log("我忘了 define");', { id: "dyn-2" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("没有调用 harness.define");
  });

  it("harness.define 形状不合法 → 就地报错", async () => {
    const result = await evaluateHostHalf("harness.define({ name: 'x' });", { id: "dyn-3" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("apply 必须是函数");
  });

  it("语法/运行时错误 → 面向模型的可读错误（提示沙箱没有 TS 类型、要用 inject）", async () => {
    const result = await evaluateHostHalf("const x: number = 1; harness.define({ apply(){} });", { id: "dyn-4" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("宿主半边求值失败");
      expect(result.error).toContain("TypeScript");
    }
  });

  it("Node API 是**教学式陷阱**：错误信息直接告诉模型该用什么", async () => {
    const cases: Array<[string, string]> = [
      ["require('fs')", "inject"],
      ["fetch('https://example.com')", "网络访问请走服务"],
      ["setTimeout(() => {}, 1)", "timer"],
    ];
    for (const [code, hint] of cases) {
      const result = await evaluateHostHalf(`${code}; harness.define({ apply(){} });`, { id: "dyn-5" });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain(hint);
    }
  });

  it("process / Buffer 保持 undefined（不做抛错 getter：否则 typeof 探测会炸）", async () => {
    const result = await evaluateHostHalf(
      `const probe = [typeof process, typeof Buffer, typeof require];
       harness.define({ name: probe.join(","), apply(){} });`,
      { id: "dyn-6" },
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.plugin.name).toBe("undefined,undefined,function"); // require 是陷阱函数（typeof function）
    expect(SANDBOX_GLOBALS).toContain("process");
  });

  it("异步 body 逃出同步超时（如实记录：超时只约束同步部分）", async () => {
    const result = await evaluateHostHalf(
      'harness.define({ apply: async () => { await new Promise((r) => r(null)); } });',
      { id: "dyn-8", timeoutMs: 1 },
    );

    expect(result.ok).toBe(true); // 求值本身是同步回归的，await 之后不受 timeout 约束
  });

  it("同步死循环被超时打断", async () => {
    const result = await evaluateHostHalf("while (true) {} harness.define({ apply(){} });", {
      id: "dyn-9",
      timeoutMs: 30,
    });

    expect(result.ok).toBe(false);
  });
});

describe("lib/dynamic/runner 生命周期", () => {
  function makeRuntime() {
    const ctx = createRootContext();
    const tools = createToolRegistry<AnyTool>();
    provideTools(ctx, tools);
    const runner = createDynamicRunner({ ctx, allowedServices: ["tools"] });
    provideDynamic(ctx, runner);
    return { ctx, tools, runner };
  }

  it("默认只登记不运行；run 后才在沙箱里挂载并生效", async () => {
    const { tools, runner } = makeRuntime();

    const defined = runner.define({ title: "演示插件", host: GOOD_CODE });
    expect(defined.state).toBe("defined");
    expect(tools.names()).toEqual([]); // 只登记，没有副作用

    const ran = await runner.run(defined.definition.id);

    expect(ran.state).toBe("running");
    expect(tools.names()).toEqual(["ping"]);
    expect(runner.runningIds()).toEqual([defined.definition.id]);
  });

  it("stop 等静默：插件注册的工具随之下线", async () => {
    const { tools, runner } = makeRuntime();
    const { definition } = runner.define({ title: "演示插件", host: GOOD_CODE });
    await runner.run(definition.id);

    const stopped = await runner.stop(definition.id);

    expect(stopped.state).toBe("stopped");
    expect(tools.names()).toEqual([]);
    expect(runner.runningIds()).toEqual([]);
  });

  it("undefine 先停再删；未知 id 返回 undefined；未知 id 的 run 报可操作错误", async () => {
    const { runner } = makeRuntime();
    const { definition } = runner.define({ title: "演示插件", host: GOOD_CODE });
    await runner.run(definition.id);

    expect(await runner.undefine(definition.id)).toMatchObject({ state: "stopped" });
    expect(runner.list()).toEqual([]);
    expect(await runner.undefine("nope")).toBeUndefined();
    await expect(runner.run("nope")).rejects.toThrow(/未知的动态插件 id/);
  });

  it("代码错误 → state=error 且 note 带可读原因（不炸宿主）", async () => {
    const { runner } = makeRuntime();
    const { definition } = runner.define({ title: "坏插件", host: "require('fs'); harness.define({ apply(){} });" });

    const record = await runner.run(definition.id);

    expect(record.state).toBe("error");
    expect(record.note).toContain("inject");
    expect(runner.runningIds()).toEqual([]);
  });

  it("服务白名单：声明白名单外的 inject → 拒绝运行（能碰什么是显式的）", async () => {
    const { runner } = makeRuntime();
    const { definition } = runner.define({
      title: "越权插件",
      host: 'harness.define({ inject: ["settings", "tools"], apply(){} });',
    });

    const record = await runner.run(definition.id);

    expect(record.state).toBe("error");
    expect(record.note).toContain("不在白名单内：settings");
  });

  it("只有客户端半边 → 待审批，不自作主张运行", async () => {
    const { runner } = makeRuntime();
    const { definition } = runner.define({ title: "只客户端", client: "harness.define({ apply(){} });" });

    const record = await runner.run(definition.id);

    expect(record.state).toBe("awaiting-approval");
    expect(runner.approve(definition.id).state).toBe("approved");
  });

  it("宿主 runner 卸载时临时插件一并回收（不留孤儿）", async () => {
    const ctx = createRootContext();
    const tools = createToolRegistry<AnyTool>();
    provideTools(ctx, tools);
    const fiber = await mount(ctx, {
      name: "dynamic-plugins",
      apply: (c: Context) => provideDynamic(c, createDynamicRunner({ ctx: c, allowedServices: ["tools"] })),
    });
    const runner = requireDynamic(ctx);
    const { definition } = runner.define({ title: "演示插件", host: GOOD_CODE });
    await runner.run(definition.id);
    expect(tools.names()).toEqual(["ping"]);

    // 卸载 runner 所在的 fiber（它内部的 group 子 fiber 先被回收）
    await fiber.dispose();

    expect(tools.names()).toEqual([]);
  });

  it("默认关闭：未装配 runner 时工具侧拿不到能力（findDynamic 为空）", async () => {
    const ctx = createRootContext();

    expect(findDynamic(ctx)).toBeUndefined();
    expect(() => requireDynamic(ctx)).toThrow(/默认关闭/);
  });
});

// 端到端：默认关闭 → 改配置启用 → 模型写的插件把自己的工具装进模型可见工具集 → 停用后消失
describe("动态插件通道的 opt-in 开关（组合清单 + 用户层 patch）", () => {
  it("默认配置：通道关闭，plugin_* 工具不存在，dynamicPlugins 服务缺席", async () => {
    const { bootHostKernel, _resetHostKernelForTest } = await import("@/server/kernel");
    const { openTestDb: openDb, initDatabase: init } = await import("@/lib/local/sqlite");
    const db = openDb();
    init(db);
    _resetHostKernelForTest();

    const kernel = await bootHostKernel({ db, settingsPath: "/tmp/does-not-exist-settings.json" });

    expect(kernel.load.skipped).toContain("dynamic-plugins");
    expect(kernel.audit.services).not.toContain("dynamicPlugins");
    expect(requireTools(kernel.ctx).names()).not.toContain("plugin_define");

    await kernel.dispose();
    _resetHostKernelForTest();
  });

  it("改 data/settings.json 启用后：服务就位、plugin_* 工具对模型可见、沙箱注册的工具可运行可回收", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const { bootHostKernel, _resetHostKernelForTest, getHostTools } = await import("@/server/kernel");
    const { openTestDb: openDb, initDatabase: init } = await import("@/lib/local/sqlite");
    const { buildToolSet } = await import("@/lib/ai/tools/registry");

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lotion-dyn-"));
    const settingsPath = path.join(dir, "settings.json");
    // 启用动态插件通道 = 一行配置（不改代码）
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({ plugins: { "dynamic-plugins": { disabled: false } } }),
      "utf-8",
    );
    const db = openDb();
    init(db);
    _resetHostKernelForTest();

    const kernel = await bootHostKernel({ db, settingsPath });
    expect(kernel.load.skipped).not.toContain("dynamic-plugins");

    const tools = getHostTools();
    expect(tools.names()).toContain("plugin_define");
    expect(tools.names()).toContain("plugin_run");

    const toolSet = buildToolSet(tools, { db, userId: "u1", context: kernel.ctx });
    const asRecord = toolSet as unknown as Record<string, { execute: (args: unknown) => Promise<string> }>;

    // 模型：先定义（只登记），再运行
    const defined = await asRecord.plugin_define.execute({
      title: "字数插件",
      host: `
        harness.define({
          name: "word-count",
          inject: ["tools"],
          apply: (ctx) => {
            ctx.get("tools").register({
              name: "wordCount",
              label: "字数统计",
              icon: "🔢",
              description: "统计字数（动态插件提供）",
              create: function () {
                return { description: "wc", inputSchema: {}, execute: async () => "共 42 字" };
              },
            });
          },
        });
      `,
    });
    expect(defined).toContain("已登记 dyn-1");

    const ran = await asRecord.plugin_run.execute({ id: "dyn-1" });
    expect(ran).toContain("已运行");
    // 动态插件注册的工具**立即出现在模型可见工具集里**（重新组装即可见）
    const rebuilt = buildToolSet(tools, { db, userId: "u1", context: kernel.ctx });
    expect(Object.keys(rebuilt as unknown as Record<string, unknown>)).toContain("wordCount");

    // 停止 → 工具下线（可逆）
    const stopped = await asRecord.plugin_stop.execute({ id: "dyn-1" });
    expect(stopped).toContain("已停止");
    expect(tools.names()).not.toContain("wordCount");

    // 撤销 → 定义也没了；inspect 反映真实状态
    await asRecord.plugin_undefine.execute({ id: "dyn-1" });
    expect(await asRecord.plugin_inspect.execute({})).toContain("没有任何动态插件定义");

    await kernel.dispose();
    _resetHostKernelForTest();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("沙箱注册的工具随 runner 卸载一并回收（不留孤儿）", async () => {
    const ctx = createRootContext();
    const tools = createToolRegistry<AnyTool>();
    provideTools(ctx, tools);
    const runner = createDynamicRunner({ ctx, allowedServices: ["tools"] });
    provideDynamic(ctx, runner);
    const { definition } = runner.define({ title: "P", host: GOOD_CODE });
    await runner.run(definition.id);
    expect(tools.names()).toEqual(["ping"]);

    await runner.stop(definition.id);

    expect(tools.names()).toEqual([]);
  });
});

// 服务隔离域：模型写的插件不能遮蔽根域的官方服务（Cordis 的 isolate 是逐名遮蔽）
describe("动态插件的服务隔离（isolate）", () => {
  /** 声称要 provide "testSvc" 的插件代码 */
  const PROVIDE_CODE = `
harness.define({
  name: "shadow-attempt",
  provide: ["testSvc"],
  apply: (ctx) => { ctx.provide("testSvc", "来自动态插件"); },
});
`;

  it("声明了 provide 的服务名会被隔离：根域服务不受影响", async () => {
    const ctx = createRootContext();
    ctx.provide("testSvc", "根域的官方值");
    const runner = createDynamicRunner({ ctx });
    provideDynamic(ctx, runner);

    const { definition } = runner.define({ title: "遮蔽尝试", host: PROVIDE_CODE });
    const record = await runner.run(definition.id);

    expect(record.state).toBe("running");
    expect(record.note).toContain("服务已隔离：testSvc");
    // 根域仍是官方值（未被遮蔽）
    expect(ctx.get("testSvc")).toBe("根域的官方值");
  });

  it("对照：不声明 provide 时同名服务会撞车（说明隔离确实在起作用）", async () => {
    const ctx = createRootContext();
    ctx.provide("testSvc", "根域的官方值");
    const runner = createDynamicRunner({ ctx });
    provideDynamic(ctx, runner);

    // 去掉 provide 声明 → runner 不隔离 → Cordis 判定"服务已被注册"
    const { definition } = runner.define({
      title: "撞车尝试",
      host: `
harness.define({
  name: "collide",
  apply: (ctx) => { ctx.provide("testSvc", "来自动态插件"); },
});
`,
    });
    const record = await runner.run(definition.id);

    expect(record.state).toBe("error");
    expect(record.note).toMatch(/has been registered|已被注册/);
    expect(ctx.get("testSvc")).toBe("根域的官方值");
  });
});
