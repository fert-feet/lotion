// 插件市场（本地目录版）。
//
// 市场清单：public/plugin-market/registry.json（可用 data/plugin-market.json 覆盖）。
// bundle 只允许同源路径（/plugin-market/*.json），不做远端抓取 —— 远端 registry 需要
// 额外的信任/超时/签名设计，留到后续；先把"发现 → 安装 → 审批"闭环跑通。
//
// ⚠️ 服务端专用。
import fs from "node:fs";
import path from "node:path";
import type { MarketEntry } from "@/lib/seams/plugins";

export interface PluginMarket {
  list(): Promise<MarketEntry[]>;
  /** 读取 bundle（返回已解析 JSON；调用方负责 validatePluginManifest） */
  bundle(url: string): Promise<unknown>;
}

export interface CreateFilePluginMarketOptions {
  /** public 根目录（测试注入临时目录） */
  publicDir?: string;
  /** registry 文件路径（测试注入）；省略时用 data/plugin-market.json 或 public 默认 */
  registryPath?: string;
}

function isEntry(value: unknown): value is MarketEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.id === "string" &&
    typeof entry.name === "string" &&
    typeof entry.version === "string" &&
    typeof entry.description === "string" &&
    typeof entry.bundle === "string"
  );
}

export function createFilePluginMarket(options: CreateFilePluginMarketOptions = {}): PluginMarket {
  const publicDir = path.resolve(options.publicDir ?? path.join(process.cwd(), "public"));
  const defaultRegistry = path.join(publicDir, "plugin-market", "registry.json");
  const overrideRegistry = path.join(process.cwd(), "data", "plugin-market.json");
  const registryPath =
    options.registryPath ?? (fs.existsSync(overrideRegistry) ? overrideRegistry : defaultRegistry);

  return {
    async list() {
      if (!fs.existsSync(registryPath)) return [];
      try {
        const raw = JSON.parse(fs.readFileSync(registryPath, "utf-8")) as unknown;
        const entries =
          Array.isArray(raw)
            ? raw
            : typeof raw === "object" && raw !== null && Array.isArray((raw as { entries?: unknown }).entries)
              ? (raw as { entries: unknown[] }).entries
              : [];
        return entries.filter(isEntry);
      } catch {
        return [];
      }
    },

    async bundle(url) {
      if (typeof url !== "string" || !url.startsWith("/")) {
        throw new Error("只支持同源 bundle 路径（以 / 开头）");
      }
      const root = publicDir.endsWith(path.sep) ? publicDir : `${publicDir}${path.sep}`;
      const file = path.resolve(publicDir, `.${url}`);
      if (!file.startsWith(root)) throw new Error("bundle 路径越界");
      if (!fs.existsSync(file)) throw new Error(`bundle 不存在：${url}`);
      return JSON.parse(fs.readFileSync(file, "utf-8")) as unknown;
    },
  };
}

/** 组合根用的默认市场（与 data/settings.json 同级约定） */
export function createDefaultPluginMarket(): PluginMarket {
  return createFilePluginMarket();
}
