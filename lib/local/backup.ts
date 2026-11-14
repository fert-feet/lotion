// 数据库快照（备份）：SQLite 单文件库的原子备份就是 `VACUUM INTO`。
//
// 背景：本地自托管版的全部数据都在 data/lotion.db（WAL 模式）。手工 cp 会拿到
// 半写状态（还有 -wal/-shm 两个旁文件），而 `VACUUM INTO 'x.db'` 由 SQLite 保证
// 生成的是一致快照。这里负责命名、保留份数与节流，不碰业务表。
import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { logger } from "@/lib/logger";

export interface BackupOptions {
  /** 备份目录（默认 <db 所在目录>/backups） */
  dir?: string;
  /** 保留份数（默认 7） */
  keep?: number;
  /** 距上次备份不足该毫秒数则跳过（默认 24h） */
  minIntervalMs?: number;
  /** 注入当前时间（测试用） */
  now?: number;
}

export interface BackupResult {
  /** 是否真的做了备份（节流命中时为 false） */
  created: boolean;
  /** 生成的备份文件路径 */
  file?: string;
  /** 清理掉的旧备份数 */
  pruned: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const PREFIX = "lotion-";
const SUFFIX = ".db";

/** 备份文件名：lotion-20260101-030405.db（按时间可排序） */
function backupName(at: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${PREFIX}${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}-${pad(
    at.getHours(),
  )}${pad(at.getMinutes())}${pad(at.getSeconds())}${SUFFIX}`;
}

/** 列出既有备份（新→旧） */
export function listBackups(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.startsWith(PREFIX) && name.endsWith(SUFFIX))
    .sort()
    // 文件名按时间可排序（lotion-YYYYMMDD-HHMMSS.db），取新→旧
    .reverse()
    .map((name) => path.join(dir, name));
}

/**
 * 生成一次数据库快照并清理超额旧备份。
 * 失败只记日志不抛（启动期的备份不该阻断启动）。
 * @param db - 已打开的连接
 * @param options - 目录 / 保留份数 / 节流 / 时间注入
 */
export function backupDatabase(db: Database.Database, options: BackupOptions = {}): BackupResult {
  const now = options.now ?? Date.now();
  const keep = options.keep ?? 7;
  const minIntervalMs = options.minIntervalMs ?? DAY_MS;
  const dir = options.dir ?? path.join(process.cwd(), "data", "backups");

  try {
    const existing = listBackups(dir);
    const latest = existing[0];
    if (latest !== undefined && minIntervalMs > 0) {
      const age = now - fs.statSync(latest).mtimeMs;
      if (age < minIntervalMs) {
        return { created: false, pruned: 0 };
      }
    }

    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, backupName(new Date(now)));
    // 参数化不了文件名：VACUUM INTO 只接受字符串字面量，故用 escape 后的 SQL 拼接
    db.prepare(`VACUUM INTO '${file.replace(/'/g, "''")}'`).run();

    let pruned = 0;
    for (const old of listBackups(dir).slice(keep)) {
      fs.unlinkSync(old);
      pruned += 1;
    }
    logger.db.info("数据库快照完成", { file: path.basename(file), pruned });
    return { created: true, file, pruned };
  } catch (e) {
    logger.db.error("数据库快照失败（跳过，不影响启动）", { error: String(e) });
    return { created: false, pruned: 0 };
  }
}
