// 已安装插件的包格式与文件存储（宿主侧）。
//
// 布局：data/plugins/installed/<id>/plugin.json（LOTION_PLUGINS_DIR 可覆盖根目录）。
// 一个包 = 单个 JSON：元数据 + 可选 host/client 源码 + 启停/审批/配置值。
// 不落 node_modules、不执行 npm 安装脚本；host 代码仍走 node:vm（不是安全边界）。
//
// ⚠️ 服务端专用。
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { provideService, readService, type Context } from "@/lib/kernel";
import type { PluginConfigField } from "@/lib/seams/plugins";
import { resolvePluginsDir } from "./dynamic-store";

/** 包 id：小写字母/数字/连字符，2–64 位（同时是目录名，禁止路径字符） */
export const INSTALLED_ID_RE = /^[a-z0-9][a-z0-9-]{1,63}$/;

/** 单段源码上限 256KB（防止市场包塞爆磁盘 / 内存） */
export const MAX_CODE_BYTES = 256 * 1024;

export const pluginConfigFieldSchema = z.object({
  key: z.string().min(1).max(64),
  label: z.string().min(1).max(80),
  type: z.enum(["string", "number", "boolean", "select", "secret"]),
  description: z.string().max(300).optional(),
  placeholder: z.string().max(200).optional(),
  options: z.array(z.string().max(100)).max(50).optional(),
  default: z.unknown().optional(),
});

export const pluginManifestSchema = z
  .object({
    id: z.string().regex(INSTALLED_ID_RE, "id 只能包含小写字母/数字/连字符（2–64 位）"),
    name: z.string().min(1).max(80),
    version: z.string().min(1).max(32),
    description: z.string().max(500).optional(),
    author: z.string().max(80).optional(),
    category: z.string().max(40).optional(),
    tags: z.array(z.string().max(30)).max(10).default([]),
    capabilities: z
      .array(z.enum(["tools", "ui", "httpRoutes"]))
      .max(3)
      .default([]),
    config: z.array(pluginConfigFieldSchema).max(20).default([]),
    enabled: z.boolean().default(false),
    approved: z.boolean().default(false),
    configValues: z.record(z.string(), z.unknown()).default({}),
    host: z.string().max(MAX_CODE_BYTES).optional(),
    client: z.string().max(MAX_CODE_BYTES).optional(),
  })
  .superRefine((manifest, ctx) => {
    if (!manifest.host && !manifest.client) {
      ctx.addIssue({
        code: "custom",
        message: "插件至少要有 host 或 client 半边代码",
        path: ["host"],
      });
    }
    if (manifest.host && manifest.host.length === 0) {
      ctx.addIssue({ code: "custom", message: "host 代码不能为空", path: ["host"] });
    }
    if (manifest.client && manifest.client.length === 0) {
      ctx.addIssue({ code: "custom", message: "client 代码不能为空", path: ["client"] });
    }
  });

export type InstalledPluginManifest = z.infer<typeof pluginManifestSchema>;

/** 校验（市场安装 / 读取文件都走同一份 schema） */
export function validatePluginManifest(raw: unknown): InstalledPluginManifest {
  const parsed = pluginManifestSchema.safeParse(raw);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .slice(0, 4)
      .map((issue) => `${issue.path.join(".") || "manifest"}: ${issue.message}`)
      .join("；");
    throw new Error(`插件清单不合法：${detail}`);
  }
  return parsed.data;
}

/**
 * 轻量版本比较：按数字段比较（1.10.0 > 1.9.0），非数字段退化为字符串比较。
 * 返回 >0 表示 a 更新。
 */
export function compareVersions(a: string, b: string): number {
  const split = (value: string) => value.split(/[.+-]/).filter(Boolean);
  const left = split(a);
  const right = split(b);
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const l = left[index] ?? "0";
    const r = right[index] ?? "0";
    const ln = Number(l);
    const rn = Number(r);
    if (Number.isFinite(ln) && Number.isFinite(rn)) {
      if (ln !== rn) return ln > rn ? 1 : -1;
      continue;
    }
    if (l !== r) return l > r ? 1 : -1;
  }
  return 0;
}

/** 已安装插件根目录：<plugins>/installed */
export function resolveInstalledDir(cwd = process.cwd()): string {
  return path.join(resolvePluginsDir(cwd), "installed");
}

export interface PluginPackageStore {
  list(): InstalledPluginManifest[];
  get(id: string): InstalledPluginManifest | undefined;
  save(manifest: InstalledPluginManifest): void;
  remove(id: string): void;
}

/**
 * 文件存储实现。
 * @param dir - 已安装插件目录（测试传临时目录）
 */
export function createFilePluginPackageStore(dir: string = resolveInstalledDir()): PluginPackageStore {
  const dirOf = (id: string): string => {
    if (!INSTALLED_ID_RE.test(id)) throw new Error(`非法的插件 id「${id}」`);
    return path.join(dir, id);
  };
  const fileOf = (id: string): string => path.join(dirOf(id), "plugin.json");

  const read = (id: string): InstalledPluginManifest | undefined => {
    try {
      const raw = JSON.parse(fs.readFileSync(fileOf(id), "utf-8")) as unknown;
      const manifest = validatePluginManifest(raw);
      return manifest.id === id ? manifest : undefined;
    } catch {
      return undefined;
    }
  };

  return {
    list() {
      if (!fs.existsSync(dir)) return [];
      const out: InstalledPluginManifest[] = [];
      for (const name of fs.readdirSync(dir)) {
        if (!INSTALLED_ID_RE.test(name)) continue;
        const manifest = read(name);
        if (manifest) out.push(manifest);
      }
      return out.sort((a, b) => a.id.localeCompare(b.id));
    },

    get: read,

    save(manifest) {
      const checked = validatePluginManifest(manifest);
      const folder = dirOf(checked.id);
      fs.mkdirSync(folder, { recursive: true });
      const file = path.join(folder, "plugin.json");
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(checked, null, 2) + "\n", "utf-8");
      fs.renameSync(tmp, file);
    },

    remove(id) {
      const folder = dirOf(id);
      fs.rmSync(folder, { recursive: true, force: true });
    },
  };
}

export const INSTALLED_STORE_SERVICE = "installedPluginStore";

/** 把包存储挂到内核（server/kernel.ts 装配后；manager 按需取） */
export function provideInstalledStore(ctx: Context, store: PluginPackageStore): void {
  provideService(ctx, INSTALLED_STORE_SERVICE, store);
}

export function findInstalledStore(ctx: Context): PluginPackageStore | undefined {
  return readService<PluginPackageStore>(ctx, INSTALLED_STORE_SERVICE);
}

/** 供类型复用：manifest 的配置字段与接缝字段同形 */
export type ManifestConfigField = PluginConfigField;
