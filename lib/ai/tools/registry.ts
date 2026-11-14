// tools 的宿主侧实现（Service Provider）：定义注册表 + ToolSet 组装。
//
// 组装职责从 lib/ai/tools/index.ts 搬到这里，并**由注册表驱动**：
// 元数据（label/icon/summary）随定义走，因此新增工具不再需要改 agent 或组装代码。
// 每次组装都会：跑守卫（拒绝即短路）→ 发 tool_start/tool_end 事件 → 记日志 → doom loop 统计。
import type Database from "better-sqlite3";
import { jsonSchema } from "ai";
import type { FlexibleSchema, ToolSet } from "ai";
import { logger } from "@/lib/logger";
import {
  createToolRegistry,
  runToolGuards,
  type ToolRegistry,
  type ToolDefinition,
  type ToolFactoryContext,
} from "@/lib/seams/tools";
import {
  argsText,
  createDoomLoopTracker,
  looksLikeFailure,
  summariseFallback,
  truncate,
  wrapToolOutput,
  type DoomLoopTracker,
  type ToolEvent,
  type ToolName,
} from "./runtime";

import { TOOL_TIMEOUT_MS } from "./runtime";

/** 内部宽松 tool 形状（AI SDK 的 tool() 返回值在类型上过于严格，这里只取用到的字段） */
export interface AnyTool {
  type?: unknown;
  description?: unknown;
  inputSchema?: unknown;
  parameters?: unknown;
  execute?: unknown;
  [key: string]: unknown;
}

export type HostToolDefinition = ToolDefinition<AnyTool>;
export type HostToolRegistry = ToolRegistry<AnyTool>;

/** 创建宿主侧工具注册表 */
export function createHostToolRegistry(): HostToolRegistry {
  return createToolRegistry<AnyTool>();
}

export interface BuildToolSetOptions {
  db: Database.Database;
  userId: string;
  onEvent?: (event: ToolEvent) => void;
  doom?: DoomLoopTracker;
  /** 内核上下文（自指类工具用；见 ToolFactoryContext.context） */
  context?: unknown;
}

/**
 * 按注册表组装 ToolSet（streamText 直接可用）。
 * 定义来自注册表 → 插件注册的工具**自动**出现在模型可见工具集里。
 */
export function buildToolSet(registry: HostToolRegistry, options: BuildToolSetOptions): ToolSet {
  const { db, userId } = options;
  const onEvent = options.onEvent ?? (() => {});
  const doom = options.doom ?? createDoomLoopTracker({});
  const definitions = registry.list();

  let seq = 0;
  // onEvent 在接缝层是 unknown（不依赖 AI 包），这里收窄回具体事件类型
  const hostContext: ToolFactoryContext = {
    db,
    userId,
    onEvent: onEvent as (event: unknown) => void,
    context: options.context,
  };
  const wrapped: Record<string, AnyTool> = {};

  for (const definition of definitions) {
    const tool = definition.create({ ...hostContext, db });
    wrapped[definition.name] = withToolEvents(
      definition,
      { ...tool, inputSchema: normalizeToolSchema(tool.inputSchema) },
      {
        nextSeq: () => ++seq,
        onEvent,
        doom,
      },
    );
  }

  // SAFETY: 上面逐个包装时保留了每个工具原本的 inputSchema/execute 形状，
  // 但 TS 无法证明"逐项替换后仍是合法 ToolSet"（键集合在运行期才齐全）。
  // 这一步只做类型层面的收口，不改变运行期对象。
  return wrapped as unknown as ToolSet;
}

/**
 * 把工具的 inputSchema 收口成 AI SDK 认识的形状。
 *
 * ⚠️ 事故背景（2026-11-02）：`plugin_*` 五个工具与插件模板/市场示例都直接写
 * **JSON Schema 字面量**（`inputSchema: {}`、`{ type: "object", additionalProperties: true }`）。
 * AI SDK v7 的 `asSchema()` 只认三种东西：Standard Schema（zod 等）、`jsonSchema()` 包装、
 * 或**函数**；普通对象会被当成函数调用 → `TypeError: schema is not a function`。
 * 更糟的是它发生在组装工具集时，**与模型是否调用该工具无关**：只要注册表里有这么一个工具，
 * 整轮对话就立刻失败（前端表现为一条「schema is not a function」的错误卡）。
 * 所以在这里统一包一层，而不是要求每个插件作者都记得写 `jsonSchema()`。
 */
/** 收口后可交给 AI SDK 的形状：标准 schema，或「返回 schema 的工厂函数」 */
export type NormalizedToolSchema = FlexibleSchema | (() => unknown);

export function normalizeToolSchema(schema: unknown): NormalizedToolSchema {
  const empty = { type: "object" as const, properties: {} };
  if (schema === null || schema === undefined) return jsonSchema(empty);
  if (typeof schema === "function") {
    // SAFETY: AI SDK 的 LazySchema 就是"无参、返回 schema"的函数；这里只把
    // `Function` 收窄成该签名，不检查它实际返回什么（AI SDK 在调用时才校验）。
    return schema as () => unknown;
  }
  if (typeof schema !== "object") return jsonSchema(empty);
  const record = schema as Record<string, unknown>;
  // zod / Standard Schema，或已经用 jsonSchema() 包过（它的产物带 validate 键）
  if ("~standard" in record || "validate" in record) {
    // SAFETY: 这两个键是 Standard Schema / AI SDK Schema 的**唯一判别标记**；
    // 完整形状校验由 AI SDK 在 asSchema() 内部完成，这里不复制那套泛型。
    return schema as unknown as FlexibleSchema;
  }
  return jsonSchema(record as never);
}

interface WrapOptions {
  nextSeq: () => number;
  onEvent: (e: ToolEvent) => void;
  doom: DoomLoopTracker;
}

/** 给单个工具套上：守卫 → 事件 → 日志 → doom loop → 输出包装 */
function withToolEvents(
  definition: HostToolDefinition,
  tool: AnyTool,
  options: WrapOptions,
): AnyTool {
  const name = definition.name as ToolName;
  const rawExecute = tool.execute;
  if (typeof rawExecute !== "function") return tool;
  const execute = rawExecute as (args: unknown, opts?: unknown) => Promise<unknown>;

  return {
    ...tool,
    timeout: TOOL_TIMEOUT_MS,
    execute: async (args: unknown) => {
      const seq = options.nextSeq();

      // 守卫：返回理由即拒绝（无 allow 返回域 → 注册顺序无法把拒绝翻回允许）
      const rejection = runToolGuards([definition], { tool: definition.name, args });
      if (rejection !== undefined) {
        const text = `工具 ${definition.name} 被拒绝：${rejection}`;
        options.onEvent({
          type: "tool_end",
          tool: name,
          seq,
          ok: false,
          summary: rejection,
          error: rejection,
        });
        logger.tools.warn(`[${definition.name}] 被守卫拒绝`, { reason: rejection });
        return wrapToolOutput(text);
      }

      const start = Date.now();
      options.onEvent({
        type: "tool_start",
        tool: name,
        seq,
        argsText: argsText(args),
        args,
      });

      try {
        const result = await execute(args);
        const text = typeof result === "string" ? result : String(result);
        const summary = definition.summarize?.(text) ?? summariseFallback(text);
        options.onEvent({ type: "tool_end", tool: name, seq, ok: true, summary });
        logger.tools.info(`[${definition.name}] 完成`, {
          args: truncate(args),
          result: truncate(text),
          ms: Date.now() - start,
        });
        // 失败/空结果计入 doom loop（成功副作用调用不参与，重置基准）
        options.doom.track(definition.name, args, looksLikeFailure(text) ? "failure" : "ok");
        return wrapToolOutput(text);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        options.onEvent({
          type: "tool_end",
          tool: name,
          seq,
          ok: false,
          summary: err.message,
          error: err.message,
        });
        logger.tools.error(`[${definition.name}] 异常`, {
          args: truncate(args),
          error: err.message,
          stack: err.stack,
          ms: Date.now() - start,
        });
        const text = `工具 ${definition.name} 执行出错：${err.message}。请告知用户稍后重试，或改用其他方式完成。`;
        options.doom.track(definition.name, args, "failure");
        return wrapToolOutput(text);
      }
    },
  };
}

