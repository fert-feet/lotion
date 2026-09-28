// tools 的宿主侧实现（Service Provider）：定义注册表 + ToolSet 组装。
//
// 组装职责从 lib/ai/tools/index.ts 搬到这里，并**由注册表驱动**：
// 元数据（label/icon/summary）随定义走，因此新增工具不再需要改 agent 或组装代码。
// 每次组装都会：跑守卫（拒绝即短路）→ 发 tool_start/tool_end 事件 → 记日志 → doom loop 统计。
import type Database from "better-sqlite3";
import type { ToolSet } from "ai";
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
    wrapped[definition.name] = withToolEvents(definition, tool, {
      nextSeq: () => ++seq,
      onEvent,
      doom,
    });
  }

  return wrapped as unknown as ToolSet;
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

