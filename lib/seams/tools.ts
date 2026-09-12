// 接缝：tools —— AI 工具的贡献点（Service Definition，宿主侧）。
//
// 三角色：
//   Definition ← 本文件：工具定义形状 + 注册表契约 + 守卫语义
//   Provider   ← lib/ai/tools/registry.ts（宿主内核装配时 provide）
//   Consumer   ← lib/agent.ts（组装 streamText 的 ToolSet）；贡献方是各工具插件
//
// 为什么需要它：此前"加一个工具"要改 4~5 处枚举（import 清单 / ToolName 联合 /
// TOOL_META / summarizeResult switch / createTools 映射表）。现在工具**自描述**地注册进服务，
// 插件挂载即注册、卸载即撤销（可逆副作用），agent 只按注册表组装。
//
// 泛型 `TTool` 让本文件不依赖 AI SDK（实现侧传入具体的 tool 类型）。
import { Context } from "@/lib/kernel";

/** 一次工具调用的执行上下文（守卫只读它） */
export interface ToolExecution {
  tool: string;
  /** 模型给出的参数（守卫可据此拒绝） */
  args: unknown;
}

/**
 * 工具守卫：**返回字符串即拒绝**（字符串是给模型看的理由），返回 undefined 表示放行。
 *
 * ⚠️ 类型上刻意没有 "allow" 返回值（对齐 DSH core/tools/src/index.ts:703-711）：
 * 守卫只能否决、不能授予 —— 于是"后面注册的守卫"无法通过顺序把一次拒绝翻回允许。
 * 多个守卫按注册顺序执行（waterfall），第一个返回理由的守卫即短路。
 */
export type ToolGuard = (execution: Readonly<ToolExecution>) => string | undefined;

/** 工具工厂的注入上下文 */
export interface ToolFactoryContext {
  /** SQLite 连接（宿主侧） */
  db: unknown;
  /** 操作主体 id */
  userId: string;
  /** 工具副作用上报（note_created / question / todo_update …） */
  onEvent: (event: unknown) => void;
  /**
   * 内核上下文（可选）。只有**自指类工具**需要它：
   * 例如 plugin_* 工具要从 ctx 取动态插件 runner。类型保持 unknown，接缝不依赖内核实现。
   */
  context?: unknown;
}

/** 工具定义：自描述（元数据 + 工厂 + 摘要 + 可选守卫） */
export interface ToolDefinition<TTool = unknown> {
  /** 工具名（唯一 id，模型可见） */
  name: string;
  /** 卡片标签（随 SSE 下发，UI 通用渲染，不需要知道工具集合） */
  label: string;
  /** 卡片图标（emoji） */
  icon: string;
  /** 给模型看的描述 */
  description: string;
  /** 工厂：按注入上下文构造 tool */
  create(context: ToolFactoryContext): TTool;
  /** 结果摘要（卡片 summary）；返回 undefined 时用默认文案 */
  summarize?(resultText: string): string | undefined;
  /** 可选守卫：返回理由即拒绝该次调用 */
  guard?: ToolGuard;
}

export interface ToolRegistry<TTool = unknown> {
  /**
   * 注册工具。
   * @throws 名字重复时抛错（一个名字一个所有者）
   */
  register(definition: ToolDefinition<TTool>): void;
  /** 注销工具（插件卸载时由 registerTool 自动调用） */
  unregister(name: string): void;
  get(name: string): ToolDefinition<TTool> | undefined;
  /** 全部定义（注册顺序） */
  list(): ReadonlyArray<ToolDefinition<TTool>>;
  /** 已注册的工具名 */
  names(): string[];
}

export const TOOLS_SERVICE = "tools";

/** 创建工具注册表 */
export function createToolRegistry<TTool>(): ToolRegistry<TTool> {
  const definitions: ToolDefinition<TTool>[] = [];

  return {
    register(definition) {
      if (!definition?.name) throw new Error("[tools] 工具定义缺少 name");
      if (!definition.label || !definition.description) {
        throw new Error(`[tools] 工具「${definition.name}」缺少 label/description（卡片与模型都需要）`);
      }
      if (typeof definition.create !== "function") {
        throw new Error(`[tools] 工具「${definition.name}」缺少 create 工厂`);
      }
      if (definitions.some((item) => item.name === definition.name)) {
        throw new Error(`[tools] 工具名「${definition.name}」已注册，不能重复注册`);
      }
      definitions.push(definition);
    },
    unregister(name) {
      const index = definitions.findIndex((item) => item.name === name);
      if (index >= 0) definitions.splice(index, 1);
    },
    get: (name) => definitions.find((item) => item.name === name),
    list: () => [...definitions],
    names: () => definitions.map((item) => item.name),
  };
}

/** 装配注册表 */
export function provideTools<TTool>(ctx: Context, registry: ToolRegistry<TTool>): void {
  if (typeof registry?.register !== "function" || typeof registry?.list !== "function") {
    throw new Error("tools 实现不完整：需要 register() / list()");
  }
  ctx.provide(TOOLS_SERVICE, registry);
}

/** 读注册表；未装配返回 undefined（可选依赖降级） */
export function findTools<TTool>(ctx: Context): ToolRegistry<TTool> | undefined {
  return ctx.get<ToolRegistry<TTool>>(TOOLS_SERVICE);
}

/** 读注册表；未装配抛错 */
export function requireTools<TTool>(ctx: Context): ToolRegistry<TTool> {
  const registry = findTools<TTool>(ctx);
  if (!registry) {
    throw new Error(
      `tools 未装配：请确认组合清单里挂载了 tools 提供方（服务 key「${TOOLS_SERVICE}」）`,
    );
  }
  return registry;
}

/**
 * 插件友好的注册入口：注册 + **配对注销**（挂到调用方 fiber 的 effect 上）。
 * 于是"插件挂载即多一个工具、卸载即撤销"是可逆副作用，而不是永久污染注册表。
 */
export function registerTool<TTool>(
  ctx: Context,
  registry: ToolRegistry<TTool>,
  definition: ToolDefinition<TTool>,
): void {
  registry.register(definition);
  ctx.effect(() => {
    registry.unregister(definition.name);
  });
}

/**
 * 按注册顺序跑守卫：第一个返回理由的守卫即拒绝。
 * @returns 拒绝理由；全部放行时返回 undefined
 */
export function runToolGuards(
  definitions: ReadonlyArray<Pick<ToolDefinition, "guard" | "name">>,
  execution: ToolExecution,
): string | undefined {
  for (const definition of definitions) {
    if (definition.name !== execution.tool) continue;
    if (!definition.guard) continue;
    const reason = definition.guard(execution);
    if (typeof reason === "string" && reason.length > 0) return reason;
  }
  return undefined;
}
