// AI 运行期配置解析 + 模型构造（服务端专用；客户端禁止导入 @/lib/ai/*，由 boundary 守卫）。
//
// 为什么单独一层：此前 lib/agent.ts / lib/compress.ts 在**模块顶层**读 AI_MODEL，
// 于是"改配置 → 必须重启进程"（API Key 更是只在启动那一刻读一次）。
// 现在改为**每次调用时解析**，优先级：
//   显式传入（来自 settings 配置层：env > data/settings.json > 组合默认）> 环境变量 > 默认值
//
// 显式传入是主干路径（server/routes 从宿主内核的 settings 取值）；
// 环境变量兜底是为了"内核未装配"的场景（单测、脚本）也能正常工作。
import { createDeepSeek, deepSeek } from "@ai-sdk/deepseek";

export const DEFAULT_AI_MODEL = "deepseek-flash";

export interface AiRuntimeConfig {
  /** 模型名（AI 对话与上下文压缩共用） */
  model: string;
  /** DeepSeek API Key；空字符串 = 未配置 */
  apiKey: string;
}

/**
 * 解析 AI 运行期配置。
 * @param override - 来自配置层的值（缺失/空串则回退环境变量）
 */
export function resolveAiRuntimeConfig(override?: Partial<AiRuntimeConfig>): AiRuntimeConfig {
  const env = typeof process !== "undefined" ? process.env : undefined;
  const model = override?.model?.trim() || env?.AI_MODEL || DEFAULT_AI_MODEL;
  const apiKey = override?.apiKey?.trim() || env?.DEEPSEEK_API_KEY || "";
  return { model, apiKey };
}

/**
 * 按运行期配置构造语言模型。
 * **必须显式传 apiKey**：默认 provider 只认进程环境变量，那样 `data/settings.json`
 * 里配的 key 就是摆设（这正是"密钥只在启动那一刻生效"的老问题）。
 */
export function createAiModel(config: AiRuntimeConfig) {
  return config.apiKey ? createDeepSeek({ apiKey: config.apiKey })(config.model) : deepSeek(config.model);
}
