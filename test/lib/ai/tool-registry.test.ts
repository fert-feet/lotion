// 工具注册表 + 守卫单测（P4）：
// 注册/去重/元数据校验、守卫拒绝语义（无 allow 返回域）、事件与摘要走定义、
// 以及"插件注册的工具自动对模型可见"这条解耦目标。
import { describe, it, expect, vi, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { openTestDb, initDatabase, isoNow } from "@/lib/local/sqlite";
import { Context, loadPlugins, createRootContext } from "@/lib/kernel";
import { mount } from "@/test/mocks/mount";
import {
  createToolRegistry,
  provideTools,
  registerTool,
  requireTools,
  runToolGuards,
  TOOLS_SERVICE,
} from "@/lib/seams/tools";
import { buildToolSet, createHostToolRegistry, type AnyTool } from "@/lib/ai/tools/registry";
import { createDefaultToolRegistry, type ToolEvent } from "@/lib/ai/tools";
import { createHostTools } from "@/server/composition";

let db: Database.Database;

beforeEach(() => {
  db = openTestDb();
  initDatabase(db);
  db.prepare(
    "INSERT INTO users (id, email, passwordHash, createdAt, updatedAt) VALUES (?,?,?,?,?)",
  ).run("u1", "u1@example.com", "hash", isoNow(), isoNow());
});

/** 造一个假 tool：execute 返回固定文本 */
function fakeTool(result: string, execute?: (args: unknown) => Promise<unknown>): AnyTool {
  return {
    description: "假工具",
    inputSchema: {},
    execute: execute ?? (async () => result),
  };
}

describe("lib/seams/tools 注册表契约", () => {
  it("注册/读取/列举，名字重复就地抛错", async () => {
    const registry = createToolRegistry<AnyTool>();
    registry.register({ name: "a", label: "A", icon: "🅰️", description: "d", create: () => fakeTool("x") });

    expect(registry.names()).toEqual(["a"]);
    expect(registry.get("a")?.label).toBe("A");
    expect(() =>
      registry.register({ name: "a", label: "A2", icon: "🅱️", description: "d", create: () => fakeTool("y") }),
    ).toThrow(/工具名「a」已注册/);
  });

  it("缺 name / label / create 就地抛错（元数据随定义走，缺了卡片与模型都用不了）", async () => {
    const registry = createToolRegistry<AnyTool>();
    expect(() =>
      registry.register({ name: "", label: "L", icon: "i", description: "d", create: () => fakeTool("x") }),
    ).toThrow(/缺少 name/);
    expect(() =>
      registry.register({
        name: "a",
        label: "",
        icon: "i",
        description: "d",
        create: () => fakeTool("x"),
      }),
    ).toThrow(/缺少 label\/description/);
  });

  it("守卫：返回字符串即拒绝；undefined 放行（类型上没有 allow）", async () => {
    const definitions = [
      {
        name: "deleteNote",
        guard: (exec: Readonly<{ tool: string; args: unknown }>) =>
          (exec.args as { hard?: boolean })?.hard ? "需要用户确认" : undefined,
      },
    ];

    expect(runToolGuards(definitions, { tool: "deleteNote", args: { hard: true } })).toBe("需要用户确认");
    expect(runToolGuards(definitions, { tool: "deleteNote", args: {} })).toBeUndefined();
    expect(runToolGuards(definitions, { tool: "other", args: {} })).toBeUndefined();
  });

  it("多个守卫按注册顺序短路；后续守卫无法把拒绝翻回允许", async () => {
    const calls: string[] = [];
    const definitions = [
      { name: "t", guard: () => { calls.push("first"); return "拒绝"; } },
      { name: "t", guard: () => { calls.push("second"); return undefined; } },
    ];

    expect(runToolGuards(definitions, { tool: "t", args: {} })).toBe("拒绝");
    expect(calls).toEqual(["first"]); // 第二个守卫根本没跑（顺序无法翻案）
  });

  it("未装配时 requireTools 抛可操作错误", async () => {
    const ctx = createRootContext();
    expect(ctx.get(TOOLS_SERVICE)).toBeUndefined();
    expect(() => requireTools(ctx)).toThrow(/tools 未装配/);
  });

  it("装配后可从内核取回（插件扩展点）", async () => {
    const ctx = createRootContext();
    const registry = createHostToolRegistry();
    provideTools(ctx, registry);

    expect(requireTools(ctx)).toBe(registry);
  });
});

describe("lib/ai/tools/registry 组装与守卫流水线", () => {
  it("按注册表组装 ToolSet：label/summarize 来自定义，事件含 seq", async () => {
    const registry = createHostToolRegistry();
    const events: ToolEvent[] = [];
    registry.register({
      name: "demo",
      label: "演示工具",
      icon: "🧪",
      description: "演示",
      summarize: (text) => `摘要：${text}`,
      create: () => fakeTool("结果文本"),
    });

    const toolSet = buildToolSet(registry, { db, userId: "u1", onEvent: (e) => events.push(e) });
    const tool = (toolSet as unknown as Record<string, AnyTool>).demo;
    const output = await (tool.execute as (args: unknown) => Promise<string>)({ q: 1 });

    expect(output).toContain("[tool_output]");
    expect(events.map((e) => e.type)).toEqual(["tool_start", "tool_end"]);
    expect(events[0]).toMatchObject({ type: "tool_start", tool: "demo", seq: 1 });
    expect(events[1]).toMatchObject({ type: "tool_end", ok: true, summary: "摘要：结果文本" });
  });

  it("守卫拒绝：不执行工具本体，直接返回拒绝理由并上报 tool_end(ok=false)", async () => {
    const registry = createHostToolRegistry();
    const events: ToolEvent[] = [];
    const execute = vi.fn(async () => "不该被调用");
    registry.register({
      name: "deleteNote",
      label: "删除",
      icon: "💥",
      description: "删除",
      guard: () => "需要用户确认",
      create: () => fakeTool("x", execute),
    });

    const toolSet = buildToolSet(registry, { db, userId: "u1", onEvent: (e) => events.push(e) });
    const tool = (toolSet as unknown as Record<string, AnyTool>).deleteNote;
    const output = await (tool.execute as (args: unknown) => Promise<string>)({});

    expect(execute).not.toHaveBeenCalled();
    expect(output).toContain("被拒绝：需要用户确认");
    expect(events).toEqual([
      { type: "tool_end", tool: "deleteNote", seq: 1, ok: false, summary: "需要用户确认", error: "需要用户确认" },
    ]);
  });

  it("无专属摘要时降级为结果前 60 字", async () => {
    const registry = createHostToolRegistry();
    registry.register({
      name: "plain",
      label: "无摘要",
      icon: "·",
      description: "d",
      create: () => fakeTool("一二三四五六七八九十".repeat(10)),
    });

    const events: ToolEvent[] = [];
    const toolSet = buildToolSet(registry, { db, userId: "u1", onEvent: (e) => events.push(e) });
    const tool = (toolSet as unknown as Record<string, AnyTool>).plain;
    await (tool.execute as (args: unknown) => Promise<string>)({});

    const end = events[1] as Extract<ToolEvent, { type: "tool_end" }>;
    expect(end.summary.endsWith("…")).toBe(true);
    expect(end.summary.length).toBeLessThanOrEqual(61);
  });

  it("内置注册表含全部 19 个工具（去枚举后的清单仍然完整）", async () => {
    const registry = createDefaultToolRegistry();

    expect(registry.names()).toEqual([
      "searchNotes",
      "listNotes",
      "readNote",
      "createNote",
      "updateNote",
      "renameNote",
      "moveNote",
      "setNoteIcon",
      "publishNote",
      "archiveNote",
      "restoreNote",
      "listTrash",
      "deleteNote",
      "askUser",
      "todoWrite",
      "getDocInfo",
      "getDocOutline",
      "getDocBlocks",
      "updateBlock",
    ]);
    expect(registry.get("createNote")?.label).toBeTruthy();
  });

  it("内置工具真的能跑（注册表路径与旧 createTools 行为一致）", async () => {
    const registry = createDefaultToolRegistry();
    const events: ToolEvent[] = [];
    const toolSet = buildToolSet(registry, { db, userId: "u1", onEvent: (e) => events.push(e) });
    const create = (toolSet as unknown as Record<string, AnyTool>).createNote;

    const text = await (create.execute as (args: unknown) => Promise<string>)({
      title: "注册表路径的笔记",
      content: "正文",
    });

    expect(text).toContain("已创建");
    expect(db.prepare("SELECT COUNT(*) c FROM documents").get()).toEqual({ c: 1 });
  });
});

describe("工具即插件（去耦合目标）", () => {
  it("插件注册的工具自动出现在 ToolSet 里（不改 agent、不改组装代码）", async () => {
    const ctx = createRootContext();
    const registry = createHostTools();

    await loadPlugins(ctx, [
      {
        id: "tools-registry",
        plugin: { name: "tools-registry", apply: (c: Context) => provideTools(c, registry) },
      },
      {
        id: "plugin-word-count",
        plugin: {
          name: "plugin/word-count",
          inject: [TOOLS_SERVICE],
          apply: (c: Context) => {
            requireTools<AnyTool>(c).register({
              name: "wordCount",
              label: "字数统计",
              icon: "🔢",
              description: "统计当前文档字数（插件提供）",
              create: () => fakeTool("共 42 字"),
            });
          },
        },
      },
    ]);

    const toolSet = buildToolSet(registry, { db, userId: "u1" });
    expect(Object.keys(toolSet as unknown as Record<string, unknown>)).toContain("wordCount");
    // 内置工具仍在（插件只是追加）
    expect(Object.keys(toolSet as unknown as Record<string, unknown>)).toContain("searchNotes");
  });

  it("插件卸载后它注册的工具随之消失（可逆副作用）", async () => {
    const ctx = createRootContext();
    const registry = createHostToolRegistry();
    provideTools(ctx, registry);
    const fiber = await mount(ctx, {
      name: "plugin/extra",
      inject: [TOOLS_SERVICE],
      apply: (c: Context) =>
        registerTool(c, requireTools<AnyTool>(c), {
          name: "extra",
          label: "额外",
          icon: "+",
          description: "d",
          create: () => fakeTool("x"),
        }),
    });
    expect(registry.names()).toEqual(["extra"]);

    await fiber.dispose();

    // 可逆副作用：插件卸载 → 它注册的工具从注册表消失（无需重启、无残留）
    expect(registry.names()).toEqual([]);
    expect(ctx.get(TOOLS_SERVICE)).toBe(registry);
  });
});
