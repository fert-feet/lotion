// 数据库快照（VACUUM INTO）单测：真实内存库 + 临时目录。
// 守三件事：① 快照能被 SQLite 打开且含数据（不是半写文件）；② 24h 节流；
// ③ 保留份数清理。失败路径只记日志不抛（启动期备份不该阻断启动）。
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { initDatabase } from "@/lib/local/sqlite";
import { backupDatabase, listBackups } from "@/lib/local/backup";

let dir: string;
let db: Database.Database;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "lotion-backup-"));
  db = new Database(":memory:");
  initDatabase(db);
});

afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("backupDatabase", () => {
  it("生成可打开的完整快照（含已写入的数据）", () => {
    db.prepare(
      "INSERT INTO users (id, email, passwordHash, name, createdAt, updatedAt) VALUES (?,?,?,?,?,?)",
    ).run("u1", "a@x.com", "s2$x$y", null, "2026-01-01", "2026-01-01");

    const result = backupDatabase(db, { dir, keep: 7, minIntervalMs: 0 });
    expect(result.created).toBe(true);
    expect(result.file && fs.existsSync(result.file)).toBe(true);

    const copy = new Database(result.file!);
    const row = copy.prepare("SELECT email FROM users").get() as { email: string };
    expect(row.email).toBe("a@x.com");
    copy.close();
  });

  it("节流：距上次快照不足 minIntervalMs 时跳过", () => {
    const first = backupDatabase(db, { dir, minIntervalMs: 0 });
    expect(first.created).toBe(true);
    const second = backupDatabase(db, { dir, minIntervalMs: 24 * 60 * 60 * 1000 });
    expect(second.created).toBe(false);
    expect(listBackups(dir)).toHaveLength(1);
  });

  it("保留份数：超出 keep 的最旧快照被清理", () => {
    // 用注入时间制造 4 个不同文件名（同一秒内文件名会相同，故错开 1 秒）
    const base = Date.parse("2026-01-01T00:00:00Z");
    const created: string[] = [];
    for (let i = 0; i < 4; i++) {
      const result = backupDatabase(db, { dir, keep: 2, minIntervalMs: 0, now: base + i * 1000 });
      if (result.file) created.push(path.basename(result.file));
    }
    expect(created).toHaveLength(4);
    // 保留的是最后生成的两份（每次备份后都会把超出 keep 的最旧一份删掉）
    const kept = listBackups(dir).map((f) => path.basename(f)).sort();
    expect(kept).toEqual(created.slice(-2).sort());
  });

  it("目录不可写时降级：返回 created=false 且不抛", () => {
    const result = backupDatabase(db, { dir: "/dev/null/nope", minIntervalMs: 0 });
    expect(result.created).toBe(false);
  });
});
