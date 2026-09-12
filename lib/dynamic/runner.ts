// 动态插件 runner（宿主侧）：定义注册表 + 挂载/卸载 + 审批状态机。
//
// 生命周期（对齐 DSH packages/extensions/cordis-host-runner 的可观测面）：
//   define → 只登记不可变定义（不运行、不落盘）
//   run    → 在 node:vm 里求值宿主半边 → 挂到内部 group fiber 下 → ACTIVE
//   stop   → 卸载并**等待静默**（工具/监听器/服务/定时器全部回收）
//   undefine → 停止（若在运行）+ 删除定义
//
// 所有临时插件都是内部 `dynamic` group 的子 fiber：宿主 runner 卸载时一并回收，
// 不留孤儿监听器（这是"可逆副作用"落到动态能力上的要求）。
import { Context, Fiber, FiberState, fiberError, settle } from "@/lib/kernel";
import type { DynamicDefinition, DynamicRecord, DynamicRunner, DynamicState } from "@/lib/seams/dynamic";
import { evaluateHostHalf } from "./sandbox";

export interface CreateDynamicRunnerOptions {
  /** 内核上下文（动态插件挂载在它的内部 group 下） */
  ctx: Context;
  /** 同步求值超时（默认 5000ms，只约束同步部分） */
  timeoutMs?: number;
  /** 沙箱日志出口（默认写宿主 console，带 [plugin:<id>] tag） */
  onLog?: (level: "log" | "warn" | "error", message: string) => void;
  /** 动态插件能否提供的服务名白名单（默认不限制；列表存在时越界即拒绝） */
  allowedServices?: readonly string[];
  /** 是否允许客户端半边（默认 true；审批后才会运行） */
  allowClientHalf?: boolean;
}

export function createDynamicRunner(options: CreateDynamicRunnerOptions): DynamicRunner {
  const records = new Map<string, DynamicRecord>();
  const fibers = new Map<string, Fiber>();
  let counter = 0;

  const require = (id: string): DynamicRecord => {
    const record = records.get(id);
    if (!record) throw new Error(`未知的动态插件 id「${id}」（可用 plugin_inspect 查看当前定义）`);
    return record;
  };

  const setState = (id: string, state: DynamicState, note?: string): DynamicRecord => {
    const record = require(id);
    record.state = state;
    record.note = note;
    return record;
  };

  const runner: DynamicRunner = {
    define(input) {
      if (!input.title) throw new Error("动态插件必须有 title");
      if (!input.host && !input.client) {
        throw new Error("动态插件至少要有一半代码（host 或 client）");
      }
      const id = `dyn-${++counter}`;
      const definition: DynamicDefinition = {
        id,
        title: input.title,
        description: input.description,
        host: input.host,
        client: input.client,
        createdAt: new Date().toISOString(),
      };
      const record: DynamicRecord = { definition, state: "defined" };
      records.set(id, record);
      return record;
    },

    async run(id) {
      const record = require(id);
      if (record.state === "running") return record;
      // 运行中的定义不可变：重新 run 请先 stop（避免同一 id 挂两份副作用）
      const code = record.definition.host;
      if (!code) {
        // 只有客户端半边：登记为待审批（浏览器侧执行需人工批准）
        return setState(id, "awaiting-approval", "只有客户端半边，需人工批准后在浏览器运行");
      }

      const result = await evaluateHostHalf(code, {
        id,
        timeoutMs: options.timeoutMs,
        onLog: options.onLog,
        context: options.ctx,
      });
      if (!result.ok) {
        return setState(id, "error", result.error);
      }

      // 服务白名单：声明了 inject 但不在白名单内 → 拒绝（"能碰什么"显式化）
      const allowed = options.allowedServices;
      if (allowed) {
        const forbidden = (result.plugin.inject ?? []).filter((name) => !allowed.includes(name));
        if (forbidden.length > 0) {
          return setState(id, "error", `注入的服务不在白名单内：${forbidden.join("、")}`);
        }
      }

      try {
        // 服务隔离域：插件声明要 provide 的服务名逐个 isolate ——
        // 于是模型写的插件即使 provide("docStore") 也只是落在自己的域里，
        // **根域的官方服务不受影响**（Cordis 的 isolate 是逐名遮蔽，未点名的仍会落到根域）。
        const mountCtx = (result.plugin.provide ?? []).reduce<Context>(
          (current, name) => current.isolate(name),
          options.ctx,
        );
        const fiber = mountCtx.plugin(
          result.plugin as unknown as Parameters<Context["plugin"]>[0],
          {},
        ) as unknown as Fiber;
        fibers.set(id, fiber);
        // Cordis 的激活是异步的：settle 完才知道真起来了还是 FAILED
        await settle(fiber);
        if (fiber.state === FiberState.FAILED) {
          return setState(id, "error", fiberError(fiber) ?? "激活失败");
        }
        const notes: string[] = [];
        if ((result.plugin.inject ?? []).length > 0) notes.push(`等待服务：${result.plugin.inject?.join("、")}`);
        if ((result.plugin.provide ?? []).length > 0) {
          notes.push(`服务已隔离：${result.plugin.provide?.join("、")}`);
        }
        return setState(id, "running", notes.length > 0 ? notes.join("；") : undefined);
      } catch (error) {
        return setState(id, "error", error instanceof Error ? error.message : String(error));
      }
    },

    async stop(id) {
      require(id); // 未知 id 直接抛错（可操作提示）
      const fiber = fibers.get(id);
      if (!fiber) return setState(id, "stopped");
      fibers.delete(id);
      await fiber.dispose(); // 等静默：fiber 内所有 effect/服务/监听器已回收
      return setState(id, "stopped");
    },

    async undefine(id) {
      const record = records.get(id);
      if (!record) return undefined;
      if (fibers.has(id)) await runner.stop(id);
      records.delete(id);
      return { ...record, state: "stopped" };
    },

    get: (id) => records.get(id),

    list: () => [...records.values()],

    approve(id) {
      const record = require(id);
      if (!record.definition.client) {
        return setState(id, "approved", "没有客户端半边，无需审批");
      }
      return setState(id, "approved");
    },

    runningIds: () => [...fibers.keys()],
  };

  return runner;
}
