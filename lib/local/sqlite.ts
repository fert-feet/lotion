// ⚠️ 服务端专用模块（better-sqlite3 原生模块，禁止客户端导入）。
// SQLite 连接单例 + 启动迁移执行器。
//
// 迁移策略（D6 决策：每次启动运行 SQL 迁移脚本）：
// - 所有 DDL 内嵌在 lib/local/migrations.ts（避免运行时读 .sql 文件的路径问题）
// - 已应用迁移记录在 _migrations 表，按序执行、幂等、事务包裹
// - 进程内单例连接，文件路径可经 LOTION_DB_PATH 覆盖（默认 <项目根>/data/lotion.db）

import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { LOCAL_MIGRATIONS } from "./migrations";

/** ISO 8601 UTC 时间戳（SQLite TEXT 存储的规范格式） */
export function isoNow(): string {
  return new Date().toISOString();
}

/** 应用层 UUID（替代 PG 的 gen_random_uuid()） */
export function newId(): string {
  return crypto.randomUUID();
}

/** 对任意实例应用 PRAGMA + 迁移（测试用 :memory: 库也走同一入口） */
export function initDatabase(db: Database.Database): void {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  runMigrations(db);
}

/** 按序执行未应用的迁移（事务包裹；已应用迁移幂等跳过） */
function runMigrations(db: Database.Database): void {
  db.exec(
    `CREATE TABLE IF NOT EXISTS _migrations (
      "name" TEXT PRIMARY KEY,
      "appliedAt" TEXT NOT NULL
    )`,
  );
  const applied = new Set(
    (db.prepare("SELECT name FROM _migrations").all() as { name: string }[]).map((r) => r.name),
  );
  const apply = db.transaction(() => {
    for (const m of LOCAL_MIGRATIONS) {
      if (applied.has(m.name)) continue;
      db.exec(m.sql);
      db.prepare("INSERT INTO _migrations (name, appliedAt) VALUES (?, ?)").run(m.name, isoNow());
    }
  });
  apply();
}

/** 默认数据库文件路径（可经 LOTION_DB_PATH 环境变量覆盖） */
export function resolveDbPath(): string {
  return process.env.LOTION_DB_PATH ?? path.join(process.cwd(), "data", "lotion.db");
}

let _db: Database.Database | null = null;

/** 进程内单例连接（惰性初始化，首次调用时建文件 + 跑迁移） */
export function getDb(): Database.Database {
  if (_db) return _db;
  const file = resolveDbPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  initDatabase(db);
  _db = db;
  return db;
}

/** 测试专用：内存库（不落盘、不影响单例） */
export function openTestDb(): Database.Database {
  const db = new Database(":memory:");
  initDatabase(db);
  return db;
}
