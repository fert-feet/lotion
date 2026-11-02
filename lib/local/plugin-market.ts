// 插件市场：本地 registry + 可选远端在线 registry。
//
// 数据源优先级（后写覆盖前写）：public/plugin-market/registry.json
//   → 远端 registryUrl → data/plugin-market.json（本机发布/覆盖）。
// bundle：
//   /plugin-market/x.json   同源 public 文件
//   local:<id>              data/plugin-market/published/<id>.json（本机发布）
//   https://...             远端（localhost 允许 http，便于本地联调）
//
// 安全：
//   * 远端只接受 HTTPS（localhost 例外），5s 超时 + 512KB 上限；
//   * bundle 计算 sha256；registry 提供 sha256 时校验；
//   * 配置 LOTION_MARKET_PUBLIC_KEY 后，带 signature 的 bundle 会做 Ed25519 验签；
//   * requireSignature=true 时拒绝未签名/验签失败的 bundle。
//
// ⚠️ 服务端专用。
import fs from "node:fs";
import path from "node:path";
import { createHash, createPublicKey, verify as verifySignature } from "node:crypto";
import type { MarketComment, MarketEntry, MarketSourceInfo } from "@/lib/seams/plugins";
import type { InstalledPluginManifest } from "./plugin-package";
import { INSTALLED_ID_RE } from "./plugin-package";

const MAX_JSON_BYTES = 512 * 1024;
const FETCH_TIMEOUT_MS = 5_000;

interface PluginStats {
  downloads: number;
  ratingSum: number;
  ratingCount: number;
  comments: MarketComment[];
}

type StatsFile = Record<string, PluginStats>;

export interface MarketBundle {
  manifest: unknown;
  /** bundle 原始文本的 sha256（hex） */
  sha256: string;
  text: string;
}

export interface PluginMarket {
  list(): Promise<MarketEntry[]>;
  bundle(entry: MarketEntry): Promise<MarketBundle>;
  recordDownload(id: string): void;
  rate(id: string, rating: number, comment?: string): void;
  /** 把已安装 manifest 发布到本机市场（data/plugin-market） */
  publish(manifest: InstalledPluginManifest): MarketEntry;
  source(): MarketSourceInfo;
}

export interface CreatePluginMarketOptions {
  /** public 根目录（测试注入） */
  publicDir?: string;
  /** data 根目录（测试注入） */
  dataDir?: string;
  /** 远端 registry URL getter（来自 market 配置；空 = 纯本地） */
  registryUrl?: () => string;
  /** 是否强制要求签名（来自 market 配置） */
  requireSignature?: () => boolean;
  /** 测试注入 fetch */
  fetchImpl?: typeof fetch;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === "string");
}

function normaliseEntry(value: unknown): MarketEntry | null {
  if (!isObject(value)) return null;
  const { id, name, version, description, bundle } = value;
  if (
    typeof id !== "string" ||
    typeof name !== "string" ||
    typeof version !== "string" ||
    typeof description !== "string" ||
    typeof bundle !== "string"
  ) {
    return null;
  }
  const comments = Array.isArray(value.comments)
    ? value.comments
        .filter(isObject)
        .map((comment) => ({
          rating: typeof comment.rating === "number" ? comment.rating : 0,
          text: typeof comment.text === "string" ? comment.text : "",
          createdAt: typeof comment.createdAt === "string" ? comment.createdAt : "",
        }))
        .filter((comment) => comment.text.length > 0)
    : undefined;

  return {
    id,
    name,
    version,
    description,
    bundle,
    ...(typeof value.author === "string" ? { author: value.author } : {}),
    ...(typeof value.category === "string" ? { category: value.category } : {}),
    ...(stringArray(value.tags) ? { tags: stringArray(value.tags) } : {}),
    ...(stringArray(value.capabilities) ? { capabilities: stringArray(value.capabilities) } : {}),
    ...(typeof value.downloads === "number" ? { downloads: value.downloads } : {}),
    ...(typeof value.rating === "number" ? { rating: value.rating } : {}),
    ...(typeof value.ratingCount === "number" ? { ratingCount: value.ratingCount } : {}),
    ...(typeof value.updatedAt === "string" ? { updatedAt: value.updatedAt } : {}),
    ...(typeof value.sha256 === "string" ? { sha256: value.sha256 } : {}),
    ...(typeof value.signature === "string" ? { signature: value.signature } : {}),
    ...(comments ? { comments } : {}),
  };
}

function entriesOf(raw: unknown): MarketEntry[] {
  const list = Array.isArray(raw)
    ? raw
    : isObject(raw) && Array.isArray(raw.entries)
      ? raw.entries
      : [];
  return list.map(normaliseEntry).filter((entry): entry is MarketEntry => entry !== null);
}

export function createPluginMarket(options: CreatePluginMarketOptions = {}): PluginMarket {
  const publicDir = path.resolve(options.publicDir ?? path.join(process.cwd(), "public"));
  const dataDir = path.resolve(options.dataDir ?? path.join(process.cwd(), "data"));
  const publicRegistry = path.join(publicDir, "plugin-market", "registry.json");
  const dataRegistry = path.join(dataDir, "plugin-market.json");
  const publishedDir = path.join(dataDir, "plugin-market", "published");
  const statsPath = path.join(dataDir, "plugin-market", "stats.json");
  const fetchImpl = options.fetchImpl ?? fetch;
  const registryUrl = () => (options.registryUrl?.() ?? "").trim();
  const requireSignature = () => options.requireSignature?.() ?? false;
  /** 远端 registry 30s 缓存：插件列表/市场页会各拉一次，避免重复网络请求 */
  let remoteCache: { url: string; at: number; entries: MarketEntry[] } | null = null;

  const readJsonFile = (file: string): unknown => {
    if (!fs.existsSync(file)) return null;
    const text = fs.readFileSync(file, "utf-8");
    if (text.length > MAX_JSON_BYTES) throw new Error(`registry 超过 ${MAX_JSON_BYTES} 字节`);
    return JSON.parse(text) as unknown;
  };

  const readStats = (): StatsFile => {
    try {
      const raw = readJsonFile(statsPath);
      if (!isObject(raw)) return {};
      const out: StatsFile = {};
      for (const [id, value] of Object.entries(raw)) {
        if (!isObject(value)) continue;
        out[id] = {
          downloads: typeof value.downloads === "number" ? value.downloads : 0,
          ratingSum: typeof value.ratingSum === "number" ? value.ratingSum : 0,
          ratingCount: typeof value.ratingCount === "number" ? value.ratingCount : 0,
          comments: Array.isArray(value.comments)
            ? value.comments.filter(isObject).map((comment) => ({
                rating: typeof comment.rating === "number" ? comment.rating : 0,
                text: typeof comment.text === "string" ? comment.text : "",
                createdAt: typeof comment.createdAt === "string" ? comment.createdAt : "",
              })).filter((comment) => comment.text.length > 0)
            : [],
        };
      }
      return out;
    } catch {
      return {};
    }
  };

  const writeStats = (stats: StatsFile) => {
    fs.mkdirSync(path.dirname(statsPath), { recursive: true });
    fs.writeFileSync(statsPath, JSON.stringify(stats, null, 2) + "\n", "utf-8");
  };

  const statsOf = (id: string): PluginStats => {
    const stats = readStats()[id];
    return stats ?? { downloads: 0, ratingSum: 0, ratingCount: 0, comments: [] };
  };

  const applyStats = (entry: MarketEntry): MarketEntry => {
    const stats = statsOf(entry.id);
    const baseCount = entry.ratingCount ?? 0;
    const baseSum = (entry.rating ?? 0) * baseCount;
    const ratingCount = baseCount + stats.ratingCount;
    const rating = ratingCount > 0 ? (baseSum + stats.ratingSum) / ratingCount : undefined;
    const comments = [...(entry.comments ?? []), ...stats.comments].slice(-10);
    return {
      ...entry,
      downloads: (entry.downloads ?? 0) + stats.downloads,
      ...(rating !== undefined ? { rating: Math.round(rating * 10) / 10 } : {}),
      ...(ratingCount > 0 ? { ratingCount } : {}),
      ...(comments.length > 0 ? { comments } : {}),
    };
  };

  const localEntries = (): MarketEntry[] => {
    const merged = new Map<string, MarketEntry>();
    for (const entry of entriesOf(readJsonFile(publicRegistry))) {
      merged.set(entry.id, { ...entry, source: "local" });
    }
    return [...merged.values()];
  };

  const assertRemoteUrl = (url: string) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error(`registry URL 不合法：${url}`);
    }
    const localhost = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
    if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && localhost)) {
      throw new Error("远端市场只支持 HTTPS（localhost 可用 HTTP）");
    }
  };

  const fetchText = async (url: string): Promise<string> => {
    assertRemoteUrl(url);
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`请求失败：HTTP ${res.status}`);
    const length = Number(res.headers.get("content-length") ?? "0");
    if (length > MAX_JSON_BYTES) throw new Error("响应超过大小上限");
    const text = await res.text();
    if (text.length > MAX_JSON_BYTES) throw new Error("响应超过大小上限");
    return text;
  };

  const remoteEntries = async (): Promise<MarketEntry[]> => {
    const url = registryUrl();
    if (!url) return [];
    if (remoteCache && remoteCache.url === url && Date.now() - remoteCache.at < 30_000) {
      return remoteCache.entries;
    }
    try {
      const raw = JSON.parse(await fetchText(url)) as unknown;
      const entries = entriesOf(raw).map((entry) => ({ ...entry, source: "remote" as const }));
      remoteCache = { url, at: Date.now(), entries };
      return entries;
    } catch (error) {
      console.warn(
        `[market] 远端 registry 不可用，只用本地目录：${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  };

  const resolveBundleText = async (entry: MarketEntry): Promise<string> => {
    if (entry.bundle.startsWith("local:")) {
      const id = entry.bundle.slice("local:".length);
      if (!INSTALLED_ID_RE.test(id)) throw new Error(`非法的本地 bundle id「${id}」`);
      const file = path.join(publishedDir, `${id}.json`);
      return fs.readFileSync(file, "utf-8");
    }
    if (entry.bundle.startsWith("/")) {
      const root = publicDir.endsWith(path.sep) ? publicDir : `${publicDir}${path.sep}`;
      const file = path.resolve(publicDir, `.${entry.bundle}`);
      if (!file.startsWith(root)) throw new Error("bundle 路径越界");
      if (!fs.existsSync(file)) throw new Error(`bundle 不存在：${entry.bundle}`);
      return fs.readFileSync(file, "utf-8");
    }
    return fetchText(entry.bundle);
  };

  const verifyBundle = (entry: MarketEntry, sha256: string) => {
    if (entry.sha256 && entry.sha256.toLowerCase() !== sha256) {
      throw new Error("bundle 校验和不匹配（可能被篡改）");
    }
    const signature = entry.signature;
    const isLocal = entry.bundle.startsWith("local:");
    if (!signature) {
      // 本机发布的插件属于 owner 自己的代码，签名策略不拦它
      if (requireSignature() && !isLocal) throw new Error("该插件未签名，当前配置要求强制验签");
      return;
    }
    const pem = process.env.LOTION_MARKET_PUBLIC_KEY?.replace(/\\n/g, "\n");
    if (!pem) {
      if (requireSignature()) throw new Error("未配置 LOTION_MARKET_PUBLIC_KEY，无法验签");
      return;
    }
    const ok = verifySignature(
      null,
      Buffer.from(sha256, "hex"),
      createPublicKey(pem),
      Buffer.from(signature, "base64"),
    );
    if (!ok) throw new Error("插件签名校验失败");
  };

  return {
    async list() {
      const merged = new Map<string, MarketEntry>();
      for (const entry of localEntries()) merged.set(entry.id, entry);
      for (const entry of await remoteEntries()) merged.set(entry.id, entry);
      // 本机发布/覆盖永远最后（优先级最高）
      for (const entry of entriesOf(readJsonFile(dataRegistry))) {
        merged.set(entry.id, { ...entry, source: "local" });
      }
      return [...merged.values()]
        .map(applyStats)
        .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "") || a.name.localeCompare(b.name));
    },

    async bundle(entry) {
      const text = await resolveBundleText(entry);
      if (text.length > MAX_JSON_BYTES) throw new Error("bundle 超过大小上限");
      const sha256 = createHash("sha256").update(text).digest("hex");
      verifyBundle(entry, sha256);
      return { manifest: JSON.parse(text) as unknown, sha256, text };
    },

    recordDownload(id) {
      const stats = readStats();
      const current = stats[id] ?? { downloads: 0, ratingSum: 0, ratingCount: 0, comments: [] };
      current.downloads += 1;
      stats[id] = current;
      writeStats(stats);
    },

    rate(id, rating, comment) {
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        throw new Error("评分必须是 1–5 的整数");
      }
      const text = (comment ?? "").trim().slice(0, 500);
      const stats = readStats();
      const current = stats[id] ?? { downloads: 0, ratingSum: 0, ratingCount: 0, comments: [] };
      current.ratingSum += rating;
      current.ratingCount += 1;
      if (text) {
        current.comments = [
          ...current.comments,
          { rating, text, createdAt: new Date().toISOString() },
        ].slice(-50);
      }
      stats[id] = current;
      writeStats(stats);
    },

    publish(manifest) {
      fs.mkdirSync(publishedDir, { recursive: true });
      const text = JSON.stringify(manifest, null, 2) + "\n";
      const sha256 = createHash("sha256").update(text).digest("hex");
      fs.writeFileSync(path.join(publishedDir, `${manifest.id}.json`), text, "utf-8");

      const entry: MarketEntry = {
        id: manifest.id,
        name: manifest.name,
        version: manifest.version,
        description: manifest.description ?? "本机发布的插件",
        bundle: `local:${manifest.id}`,
        ...(manifest.author ? { author: manifest.author } : {}),
        ...(manifest.category ? { category: manifest.category } : {}),
        ...(manifest.tags.length > 0 ? { tags: manifest.tags } : {}),
        capabilities: manifest.capabilities,
        sha256,
        updatedAt: new Date().toISOString(),
        source: "local",
      };

      const existing = entriesOf(readJsonFile(dataRegistry));
      const next = [...existing.filter((item) => item.id !== entry.id), entry];
      fs.mkdirSync(path.dirname(dataRegistry), { recursive: true });
      fs.writeFileSync(
        dataRegistry,
        JSON.stringify({ entries: next }, null, 2) + "\n",
        "utf-8",
      );
      return applyStats(entry);
    },

    source() {
      const url = registryUrl();
      return { url, remote: url.length > 0, requireSignature: requireSignature() };
    },
  };
}

/** 组合根用的默认市场（registry URL / 验签策略由 settings 的 market 命名空间提供） */
export function createDefaultPluginMarket(options: {
  publicDir?: string;
  dataDir?: string;
  registryUrl?: () => string;
  requireSignature?: () => boolean;
} = {}): PluginMarket {
  return createPluginMarket(options);
}
