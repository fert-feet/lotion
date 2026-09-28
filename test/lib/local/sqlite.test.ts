// 本地 SQLite 层单测：用 :memory: 真实数据库验证 DDL 与迁移执行器
// （内存库不连任何外部服务，符合"后台代码必须配单测"约定）
import { describe, it, expect, beforeEach } from "vitest";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { initDatabase, openTestDb, isoNow, newId } from "@/lib/local/sqlite";

describe("lib/local/sqlite", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openTestDb();
  });

  it("初始迁移创建全部业务表与迁移记录表", () => {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r) => (r as { name: string }).name);
    expect(tables).toEqual(
      expect.arrayContaining([
        "_migrations",
        "users",
        "sessions",
        "documents",
        "chat_sessions",
        "chat_messages",
        "ai_changes",
      ]),
    );
    const applied = db.prepare("SELECT name FROM _migrations").all() as { name: string }[];
    expect(applied.map((m) => m.name)).toEqual([
      "001_initial_schema",
      "002_chat_message_metadata",
      "003_ai_changes",
    ]);
  });

  it("迁移幂等：重复 init 不报错、不重复记录", () => {
    initDatabase(db);
    initDatabase(db);
    const rows = db.prepare("SELECT name FROM _migrations").all() as { name: string }[];
    expect(rows).toHaveLength(3);
  });

  it("WAL 与 foreign_keys PRAGMA 生效", () => {
    // :memory: 库无 WAL（journal_mode=memory），WAL 需用文件库验证
    const fk = db.pragma("foreign_keys", { simple: true });
    expect(fk).toBe(1);

    const file = new Database(path.join(tmpdir(), `lotion-test-${Date.now()}.db`));
    try {
      initDatabase(file);
      const wal = file.pragma("journal_mode", { simple: true });
      expect(wal).toBe("wal");
    } finally {
      file.close();
    }
  });

  it("外键级联：删除用户级联删除其文档与会话", () => {
    const userId = newId();
    db.prepare("INSERT INTO users (id, email, passwordHash, createdAt, updatedAt) VALUES (?,?,?,?,?)").run(
      userId, "a@x.com", "h", isoNow(), isoNow(),
    );
    db.prepare(
      "INSERT INTO documents (id, title, userId, createdAt, updatedAt) VALUES (?,?,?,?,?)",
    ).run(newId(), "t", userId, isoNow(), isoNow());
    db.prepare(
      "INSERT INTO chat_sessions (id, userId, createdAt, updatedAt) VALUES (?,?,?,?)",
    ).run(newId(), userId, isoNow(), isoNow());
    db.prepare("DELETE FROM users WHERE id = ?").run(userId);
    const docs = db.prepare("SELECT COUNT(*) AS n FROM documents").get() as { n: number };
    const sessions = db.prepare("SELECT COUNT(*) AS n FROM chat_sessions").get() as { n: number };
    expect(docs.n).toBe(0);
    expect(sessions.n).toBe(0);
  });

  it("父文档删除后子文档 parentDocument 置 NULL（ON DELETE SET NULL）", () => {
    const userId = newId();
    db.prepare("INSERT INTO users (id, email, passwordHash, createdAt, updatedAt) VALUES (?,?,?,?,?)").run(
      userId, "b@x.com", "h", isoNow(), isoNow(),
    );
    const parentId = newId();
    const childId = newId();
    db.prepare(
      "INSERT INTO documents (id, title, userId, createdAt, updatedAt) VALUES (?,?,?,?,?)",
    ).run(parentId, "parent", userId, isoNow(), isoNow());
    db.prepare(
      "INSERT INTO documents (id, title, userId, parentDocument, createdAt, updatedAt) VALUES (?,?,?,?,?,?)",
    ).run(childId, "child", userId, parentId, isoNow(), isoNow());
    db.prepare("DELETE FROM documents WHERE id = ?").run(parentId);
    const child = db.prepare("SELECT parentDocument FROM documents WHERE id = ?").get(childId) as {
      parentDocument: string | null;
    };
    expect(child.parentDocument).toBeNull();
  });

  it("requestId 部分唯一索引：同用户重复 requestId 冲突，NULL 不受限", () => {
    const userId = newId();
    db.prepare("INSERT INTO users (id, email, passwordHash, createdAt, updatedAt) VALUES (?,?,?,?,?)").run(
      userId, "c@x.com", "h", isoNow(), isoNow(),
    );
    const insert = db.prepare(
      "INSERT INTO chat_messages (id, userId, role, content, requestId, createdAt) VALUES (?,?,?,?,?,?)",
    );
    insert.run(newId(), userId, "user", "hi", "req-1", isoNow());
    insert.run(newId(), userId, "user", "hi", null, isoNow());
    insert.run(newId(), userId, "user", "hi", null, isoNow()); // NULL 不受唯一约束
    expect(() => insert.run(newId(), userId, "user", "hi", "req-1", isoNow())).toThrow(/UNIQUE/);
  });

  it("role CHECK 约束拒绝非法角色", () => {
    const userId = newId();
    db.prepare("INSERT INTO users (id, email, passwordHash, createdAt, updatedAt) VALUES (?,?,?,?,?)").run(
      userId, "d@x.com", "h", isoNow(), isoNow(),
    );
    expect(() =>
      db.prepare(
        "INSERT INTO chat_messages (id, userId, role, content, createdAt) VALUES (?,?,?,?,?)",
      ).run(newId(), userId, "system", "x", isoNow()),
    ).toThrow(/CHECK/);
  });

  it("isoNow 输出 ISO 8601 UTC 格式，newId 为合法 UUID", () => {
    expect(isoNow()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(newId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
