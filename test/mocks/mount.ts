// 测试辅助：把"Cordis 的异步激活"收敛成一个 await（settle 整棵树）。
//
// 不只 settle 这个 fiber：Cordis 的 `inject` 门控在**依赖出现后**的下一个微任务才激活，
// 而依赖方常常挂在别的 fiber 上（例如 installSettingsSection 的消费方挂在根 fiber）。
import { settleAll, type Context, type Fiber } from "@/lib/kernel";

export async function mount(ctx: Context, plugin: unknown, config?: unknown): Promise<Fiber> {
  const fiber = ctx.plugin(plugin as Parameters<Context["plugin"]>[0], config) as unknown as Fiber;
  await settleAll(ctx);
  return fiber;
}
