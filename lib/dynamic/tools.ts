// plugin_* 工具：把动态插件通道暴露给模型（**仅在启用时才注册**）。
//
// 工具语义（⚠️ **不**对齐 DSH 出厂实现）：DSH 出厂的 dsh-tool-cordis 只注册
// cordis_inspect_list / cordis_inspect_query 两个**只读**工具，其 README 明确
// "Shipped model tools cannot create or update dynamic definitions"；
// cordis_define / cordis_run / cordis_stop / cordis_undefine 在 DSH 里**没有**
// 任何包注册它们，仅作为历史卡片名留在 UI i18n 里。
// 也就是说本文件的五个动作比参照实现更宽 —— 这是有意的产品选择（默认关 + 人工 approve
// 兜底），而非"与 DSH 对齐"，不要照 DSH 的文档去理解这里的权限面。
//   plugin_inspect  只读：列出当前定义与状态（模型先看再动手）
//   plugin_define   只登记代码，**不运行**（让模型能分两步走：先交代码，再单独运行）
//   plugin_run      在 node:vm 里求值宿主半边并挂载
//   plugin_stop     卸载并等静默（工具/监听器/服务全部回收）
//   plugin_undefine 停止 + 删除定义
//
// ⚠️ 这五个工具默认**不注册**（组合清单里 dynamic-plugins 条目默认 disabled）；
// 它们的能力与本机 shell 同级信任，属于 opt-in 开发通道，不是安全边界。
import { Context } from "@/lib/kernel";
import { requireDynamic, type DynamicRunner } from "@/lib/seams/dynamic";
import type { ToolDefinition } from "@/lib/seams/tools";
import type { AnyTool } from "@/lib/ai/tools/registry";

/** 从工具工厂上下文里取 runner（未启用时给出可操作的错误） */
function runnerFrom(context: unknown): DynamicRunner {
  if (!context) {
    throw new Error("动态插件通道未启用（需要宿主内核上下文）");
  }
  return requireDynamic(context as Context);
}

/** 渲染定义列表（plugin_inspect 的输出） */
export function formatDynamicRecords(runner: DynamicRunner): string {
  const records = runner.list();
  if (records.length === 0) return "当前没有任何动态插件定义。";
  const lines = records.map((record) => {
    const halves = [record.definition.host ? "host" : null, record.definition.client ? "client" : null]
      .filter(Boolean)
      .join("+");
    return `- ${record.definition.id} 「${record.definition.title}」（${halves}）状态：${record.state}${
      record.note ? ` — ${record.note}` : ""
    }`;
  });
  return `动态插件共 ${records.length} 个（仅存在于进程内存，重启即消失）：\n${lines.join("\n")}`;
}

/** 造一个动态插件工具（统一包装：取 runner → 执行 → 返回给模型的可读文本） */
function dynamicTool(input: {
  name: string;
  label: string;
  icon: string;
  description: string;
  run: (runner: DynamicRunner, args: Record<string, unknown>) => Promise<string> | string;
  summarize: (text: string) => string;
}): ToolDefinition<AnyTool> {
  return {
    name: input.name,
    label: input.label,
    icon: input.icon,
    description: input.description,
    summarize: input.summarize,
    create: ({ context }) => {
      const runner = runnerFrom(context);
      return {
        description: input.description,
        inputSchema: { type: "object", additionalProperties: true },
        execute: async (args: Record<string, unknown>) => input.run(runner, args ?? {}),
      };
    },
  };
}

/** 五个 plugin_* 工具定义 */
export function dynamicPluginTools(): Array<ToolDefinition<AnyTool>> {
  return [
    dynamicTool({
      name: "plugin_inspect",
      label: "查看动态插件",
      icon: "🔎",
      description:
        "列出当前进程里的动态插件定义与状态（id/标题/半边/state）。改代码前先看这里，避免重复定义。",
      run: (runner) => formatDynamicRecords(runner),
      summarize: (text) => (text.includes("没有任何") ? "当前无定义" : `共 ${text.match(/共 (\d+) 个/)?.[1] ?? "?"} 个定义`),
    }),
    dynamicTool({
      name: "plugin_define",
      label: "定义动态插件",
      icon: "🧩",
      description:
        "登记一个动态插件定义（**只登记，不运行**）。host 半边的代码运行在 node:vm 沙箱里：没有 require/fetch/定时器（用它们会报错并提示替代写法），没有 TypeScript 类型标注；需要能力时声明 inject: ['tools'] 之类，并在 apply 里用 ctx.get('tools')。代码末尾必须调用 harness.define({ name?, inject?, apply })。",
      run: (runner, args) => {
        const record = runner.define({
          title: String(args.title ?? "未命名插件"),
          description: args.description === undefined ? undefined : String(args.description),
          host: args.host === undefined ? undefined : String(args.host),
          client: args.client === undefined ? undefined : String(args.client),
        });
        return `已登记 ${record.definition.id}「${record.definition.title}」，状态 ${record.state}。用 plugin_run 运行它。`;
      },
      summarize: (text) => text,
    }),
    dynamicTool({
      name: "plugin_run",
      label: "运行动态插件",
      icon: "▶️",
      description: "运行指定 id 的宿主半边（在 node:vm 沙箱里求值并挂载）。失败会返回可读原因，不会影响宿主。",
      run: async (runner, args) => {
        const record = await runner.run(String(args.id ?? ""));
        if (record.state === "error") return `运行失败：${record.note ?? "未知原因"}`;
        return `${record.definition.id} 已运行（状态 ${record.state}）${record.note ? `；${record.note}` : ""}`;
      },
      summarize: (text) => (text.startsWith("运行失败") ? text : "已运行"),
    }),
    dynamicTool({
      name: "plugin_stop",
      label: "停止动态插件",
      icon: "⏹️",
      description: "停止指定 id 并等待静默（它注册的工具/监听器/服务全部下线）。定义仍保留，可再次运行。",
      run: async (runner, args) => {
        const record = await runner.stop(String(args.id ?? ""));
        return `${record.definition.id} 已停止（状态 ${record.state}）`;
      },
      summarize: () => "已停止",
    }),
    dynamicTool({
      name: "plugin_undefine",
      label: "撤销动态插件",
      icon: "🗑️",
      description: "停止并删除指定 id 的定义（临时插件只存在于内存，删除即彻底消失）。",
      run: async (runner, args) => {
        const record = await runner.undefine(String(args.id ?? ""));
        return record ? `${record.definition.id} 已撤销` : `未找到 ${String(args.id ?? "")}`;
      },
      summarize: (text) => text,
    }),
  ];
}

/** 把 plugin_* 工具注册进工具注册表（由 dynamic-plugins 组合条目在启用时调用） */
export function registerDynamicPluginTools(registry: {
  register: (definition: ToolDefinition<AnyTool>) => void;
}): void {
  for (const definition of dynamicPluginTools()) registry.register(definition);
}
