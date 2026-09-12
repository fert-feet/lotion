// 启动时加载 env 文件（Next.js → Hono 迁移后的必要补课）。
//
// Next.js 会自动读取 .env.local / .env 并注入 process.env；tsx / node **不会**，
// 于是迁移后 DEEPSEEK_API_KEY 丢失，@ai-sdk/deepseek 在请求时抛
// "DeepSeek API key is missing. Pass it using the 'apiKey' parameter or the
// DEEPSEEK_API_KEY environment variable."（前端表现为「AI 生成出错」toast）。
//
// 语义与 Node 的 --env-file 一致：**已存在的环境变量优先**，文件不覆盖真实环境变量；
// 因此 shell 里显式 export 的 key（或部署平台注入的变量）始终胜过 .env 文件。
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import path from "node:path";

/** 仓库根目录（本文件位于 <root>/server/）。env 文件锚定根目录，不受启动时 CWD 影响。 */
const ROOT = path.resolve(import.meta.dirname, "..");

/** 默认加载顺序：.env.local 优先于 .env（与 Next.js 约定一致）。 */
export const ENV_FILES: readonly string[] = [
  path.join(ROOT, ".env.local"),
  path.join(ROOT, ".env"),
];

/**
 * 依次加载存在的 env 文件；不存在的文件静默跳过（.env 是可选的）。
 * 前一个文件写入的值会先进入 process.env，因此**先加载的文件优先**。
 * @param files - 待加载文件路径（默认 ENV_FILES）；相对路径按当前工作目录解析
 * @returns 实际加载的文件路径列表（启动日志用，不含任何变量值）
 */
export function loadEnvFiles(files: readonly string[] = ENV_FILES): string[] {
  const loaded: string[] = [];
  for (const file of files) {
    if (!existsSync(file)) continue;
    loadEnvFile(file);
    loaded.push(file);
  }
  return loaded;
}
