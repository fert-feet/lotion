// 本地 Auth 核心单测（scrypt 哈希 / 用户 / 会话生命周期）
import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { openTestDb } from "@/lib/local/sqlite";
import {
  hashPassword,
  verifyPassword,
  isValidEmail,
  createUser,
  loginUser,
  createSession,
  getSessionUser,
  deleteSession,
  AuthError,
  SESSION_TTL_DAYS,
} from "@/lib/local/auth";

describe("lib/local/auth 密码哈希", () => {
  it("哈希可验证，错误密码/畸形存储返回 false", () => {
    const stored = hashPassword("correct horse");
    expect(stored.startsWith("s1$")).toBe(true);
    expect(verifyPassword("correct horse", stored)).toBe(true);
    expect(verifyPassword("wrong", stored)).toBe(false);
    expect(verifyPassword("x", "not-a-valid-format")).toBe(false);
    expect(verifyPassword("x", "")).toBe(false);
  });

  it("同一密码两次哈希盐不同（存储不可预测）", () => {
    expect(hashPassword("same")).not.toBe(hashPassword("same"));
  });

  it("邮箱格式校验", () => {
    expect(isValidEmail("a@b.com")).toBe(true);
    expect(isValidEmail("not-an-email")).toBe(false);
    expect(isValidEmail("a@b")).toBe(false);
  });
});

describe("lib/local/auth 用户与会话", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openTestDb();
  });

  it("createUser 注册成功并归一化邮箱（小写/去空白）", () => {
    const user = createUser(db, "  Alice@Example.COM ", "password123", "Alice");
    expect(user.email).toBe("alice@example.com");
    expect(user.name).toBe("Alice");
    expect(user.id).toBeTruthy();
    // 密码不落明文：库里是 scrypt 哈希
    const row = db.prepare("SELECT passwordHash FROM users WHERE id = ?").get(user.id) as {
      passwordHash: string;
    };
    expect(row.passwordHash).not.toContain("password123");
    expect(verifyPassword("password123", row.passwordHash)).toBe(true);
  });

  it("createUser 校验：非法邮箱/短密码抛 INVALID_INPUT，重复邮箱抛 EMAIL_EXISTS（大小写不敏感）", () => {
    expect(() => createUser(db, "bad", "password123")).toThrowError(AuthError);
    expect(() => createUser(db, "a@b.com", "short")).toThrowError(AuthError);
    createUser(db, "dup@x.com", "password123");
    expect(() => createUser(db, "DUP@x.com", "password123")).toThrowError(
      /已注册/,
    );
  });

  it("loginUser 登录成功；错误密码/未知邮箱统一抛 INVALID_CREDENTIALS", () => {
    createUser(db, "u@x.com", "password123", "U");
    const user = loginUser(db, "U@X.COM", "password123"); // 大小写不敏感
    expect(user.email).toBe("u@x.com");

    const expectInvalid = (fn: () => unknown) => {
      try {
        fn();
        expect.unreachable("应抛出 INVALID_CREDENTIALS");
      } catch (e) {
        expect(e).toBeInstanceOf(AuthError);
        expect((e as AuthError).code).toBe("INVALID_CREDENTIALS");
      }
    };
    expectInvalid(() => loginUser(db, "u@x.com", "wrong-pass"));
    expectInvalid(() => loginUser(db, "ghost@x.com", "password123"));
  });

  it("会话生命周期：创建→按 token 取用户→注销后失效", () => {
    const user = createUser(db, "s@x.com", "password123");
    const token = createSession(db, user.id);

    const found = getSessionUser(db, token);
    expect(found).toEqual({ id: user.id, email: "s@x.com", name: null });

    deleteSession(db, token);
    expect(getSessionUser(db, token)).toBeNull();
  });

  it("无效 token / 空 token 返回 null", () => {
    expect(getSessionUser(db, "nonexistent")).toBeNull();
    expect(getSessionUser(db, null)).toBeNull();
    expect(getSessionUser(db, undefined)).toBeNull();
  });

  it("过期会话被判定失效并顺带删除", () => {
    const user = createUser(db, "e@x.com", "password123");
    const token = createSession(db, user.id);
    // 直接把过期时间改成过去
    db.prepare("UPDATE sessions SET expiresAt = ? WHERE id = ?").run(
      "2000-01-01T00:00:00.000Z",
      token,
    );
    expect(getSessionUser(db, token)).toBeNull();
    expect(db.prepare("SELECT COUNT(*) AS n FROM sessions").get() as { n: number }).toStrictEqual({ n: 0 });
  });

  it("createSession 顺手清理同用户过期会话", () => {
    const user = createUser(db, "c@x.com", "password123");
    const t1 = createSession(db, user.id);
    db.prepare("UPDATE sessions SET expiresAt = ? WHERE id = ?").run(
      "2000-01-01T00:00:00.000Z",
      t1,
    );
    createSession(db, user.id);
    const rows = db
      .prepare("SELECT id FROM sessions WHERE userId = ?")
      .all(user.id) as { id: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].id).not.toBe(t1);
  });

  it("会话默认 30 天有效期", () => {
    const user = createUser(db, "t@x.com", "password123");
    const token = createSession(db, user.id);
    const row = db.prepare("SELECT expiresAt, createdAt FROM sessions WHERE id = ?").get(token) as {
      expiresAt: string;
      createdAt: string;
    };
    const ttlMs = Date.parse(row.expiresAt) - Date.parse(row.createdAt);
    expect(ttlMs).toBe(SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  });
});
