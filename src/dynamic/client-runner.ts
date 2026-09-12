// 客户端半边 runner：从宿主取「已批准」的客户端半边并在浏览器沙箱里运行。
//
// 门禁只有一个：**宿主侧是否启用了 dynamic-plugins**（默认关闭）。
// 客户端不引入第二个开关 —— 它去问宿主：端点不存在（404）就什么都不做。
// 于是"启用动态插件通道"这件事在配置里只有一处（data/settings.json 的 plugins patch）。
//
// 安全姿态（如实）：客户端半边在浏览器里执行、影响用户所见，因此**只有 approved 的定义**才下发与运行；
// 沙箱只遮蔽裸标识符（见 lib/dynamic/client-sandbox.ts 的局限说明），属于与宿主同级的信任。
import { settle, type Context, type Fiber, type PluginObject } from "@/lib/kernel";
import { findRemote } from "@/lib/seams/remote";
import { requireUiSlots, UI_SLOTS_SERVICE } from "@/lib/seams/ui-slots";
import { evaluateClientHalf } from "@/lib/dynamic/client-sandbox";

export interface ClientHalfDefinition {
  id: string;
  title: string;
  description?: string | null;
  client: string;
}

export interface ClientHalfRunReport {
  /** 宿主未启用通道（端点 404 或不可达） */
  channelEnabled: boolean;
  ran: string[];
  failed: Array<{ id: string; error: string }>;
}

/**
 * 取宿主下发的已批准客户端半边。
 * @returns 空数组表示通道关闭（404/403/网络失败一律按"关闭"处理，不打扰用户）
 */
export async function fetchClientHalves(ctx: Context): Promise<ClientHalfDefinition[]> {
  const remote = findRemote(ctx);
  if (!remote) return [];
  try {
    const list = await remote.call<ClientHalfDefinition[]>({ namespace: "dynamic", method: "plugins" });
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/**
 * 运行客户端半边：逐个在沙箱里求值并 apply（贡献 UI 插槽）。
 * **async**：Cordis 的插件激活是异步的，必须 settle 才知道贡献是否就位。
 * 失败只记录、不影响其它半边。
 */
export async function runClientHalves(
  initialCtx: Context,
  halves: ClientHalfDefinition[],
): Promise<ClientHalfRunReport> {
  const report: ClientHalfRunReport = { channelEnabled: true, ran: [], failed: [] };
  for (const half of halves) {
    const result = evaluateClientHalf(half.client, { id: half.id });
    if (!result.ok) {
      report.failed.push({ id: half.id, error: result.error });
      continue;
    }
    try {
      // 每个半边在自己的 fiber 下运行：卸载即撤销它贡献的插槽
      // ⚠️ Cordis 的 ctx.plugin 第二参是 **config**（旧内核是 MountOptions），名字放在插件对象里
      const fiber = initialCtx.plugin(
        {
          name: `dyn-client:${half.id}`,
          inject: [UI_SLOTS_SERVICE],
          apply: (ctx: Context) => {
            void result.plugin.apply(ctx);
          },
        } as unknown as Parameters<Context["plugin"]>[0],
      ) as unknown as Fiber;
      await settle(fiber);
      report.ran.push(half.id);
    } catch (error) {
      report.failed.push({ id: half.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return report;
}

/**
 * 客户端内核的一个组合条目：启动时拉取并运行已批准的客户端半边。
 * 通道关闭时是**完全无副作用**的空操作。
 */
export const dynamicClientPlugin: PluginObject = {
  name: "dynamic-client",
  inject: [UI_SLOTS_SERVICE],
  apply(ctx) {
    // 只做注册动作，不阻塞启动：失败静默（通道多半是关闭的）
    void fetchClientHalves(ctx).then((halves) => {
      if (halves.length > 0) void runClientHalves(ctx, halves);
    });
  },
};

/** 供 UI/调试：手动触发一次同步（返回报告） */
export async function syncClientHalves(ctx: Context): Promise<ClientHalfRunReport> {
  requireUiSlots(ctx); // 未装配就是装配问题，直接抛
  const halves = await fetchClientHalves(ctx);
  if (halves.length === 0) return { channelEnabled: false, ran: [], failed: [] };
  return await runClientHalves(ctx, halves);
}
