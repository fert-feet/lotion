// 动态插件的文件持久化（宿主侧）。
//
// 目录：data/plugins/dynamic/<id>.json（LOTION_PLUGINS_DIR 可覆盖根目录）。
// 只存定义 + 审批状态；**运行中的 fiber 不落盘**，重启后 runner 会把它归为 stopped。
//
// ⚠️ 服务端专用。写入用临时文件 + rename，避免半截 JSON。
import fs from "node:fs";
import path from "node:path";
import type { DynamicPersistence, DynamicRecord, DynamicState } from "@/lib/seams/dynamic";

const ID_RE = /^[a-z0-9][a-z0-9_-]{1,63}$/;
const STATES = new Set<DynamicState>([
  "defined",
  "running",
  "awaiting-approval",
  "approved",
  "stopped",
  "error",
]);

/** 插件数据根目录（默认 data/plugins；测试/部署可注入） */
export function resolvePluginsDir(cwd = process.cwd()): string {
  const override = process.env.LOTION_PLUGINS_DIR;
  return override ? path.resolve(cwd, override) : path.join(cwd, "data", "plugins");
}

/** 动态定义目录：<root>/dynamic */
export function resolveDynamicDir(cwd = process.cwd()): string {
  return path.join(resolvePluginsDir(cwd), "dynamic");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 宽容解析：坏文件只跳过，不影响其它定义 */
function parseRecord(raw: unknown): DynamicRecord | null {
  if (!isObject(raw) || !isObject(raw.definition)) return null;
  const definition = raw.definition;
  const id = definition.id;
  const title = definition.title;
  const createdAt = definition.createdAt;
  if (typeof id !== "string" || !ID_RE.test(id)) return null;
  if (typeof title !== "string" || title.trim() === "") return null;
  if (typeof createdAt !== "string") return null;
  if (typeof raw.state !== "string" || !STATES.has(raw.state as DynamicState)) return null;

  const host = definition.host;
  const client = definition.client;
  if (host !== undefined && typeof host !== "string") return null;
  if (client !== undefined && typeof client !== "string") return null;

  const record: DynamicRecord = {
    definition: {
      id,
      title,
      createdAt,
      ...(typeof definition.description === "string" ? { description: definition.description } : {}),
      ...(typeof host === "string" ? { host } : {}),
      ...(typeof client === "string" ? { client } : {}),
    },
    state: raw.state as DynamicState,
  };
  if (typeof raw.note === "string") record.note = raw.note;
  return record;
}

/**
 * 文件持久化实现。
 * @param dir - 动态定义目录（测试传临时目录）
 */
export function createFileDynamicPersistence(dir: string = resolveDynamicDir()): DynamicPersistence {
  const fileOf = (id: string): string => {
    if (!ID_RE.test(id)) throw new Error(`非法的动态插件 id「${id}」`);
    return path.join(dir, `${id}.json`);
  };

  return {
    load() {
      if (!fs.existsSync(dir)) return [];
      const records: DynamicRecord[] = [];
      for (const name of fs.readdirSync(dir)) {
        if (!name.endsWith(".json")) continue;
        try {
          const file = path.join(dir, name);
          const parsed = parseRecord(JSON.parse(fs.readFileSync(file, "utf-8")));
          // 文件名必须与内部 id 对齐（防止手工塞进来的错位文件）
          if (!parsed || `${parsed.definition.id}.json` !== name) continue;
          records.push(parsed);
        } catch {
          // 坏 JSON / 读失败：跳过该条
        }
      }
      return records.sort((a, b) => a.definition.createdAt.localeCompare(b.definition.createdAt));
    },

    save(record) {
      fs.mkdirSync(dir, { recursive: true });
      const file = fileOf(record.definition.id);
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(record, null, 2) + "\n", "utf-8");
      fs.renameSync(tmp, file);
    },

    remove(id) {
      const file = fileOf(id);
      try {
        fs.unlinkSync(file);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    },
  };
}
