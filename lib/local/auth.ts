// ⚠️ 服务端专用模块（node:crypto，禁止客户端导入）。
// 自研极简 Auth（D2 决策）：scrypt 密码哈希 + DB session 表 + HttpOnly cookie。
// 不做 JWT：token 存库，服务端可吊销、可查过期，本地单机场景足够且更简单。

import "server-only";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type Database from "better-sqlite3";
import { isoNow, newId } from "./sqlite";

export const SESSION_COOKIE = "lotion_session";
export const SESSION_TTL_DAYS = 30; // 会话有效期（天）
export const MIN_PASSWORD_LENGTH = 8;

// scrypt 参数（与 OWASP 推荐同量级；maxmem 显式放宽，防 Node 默认 32MB 限制抛错）
const SCRYPT = { N: 16384, r: 8, p: 1 } as const;
const KEY_LEN = 64;
const SCRYPT_OPTS = { ...SCRYPT, maxmem: 64 * 1024 * 1024 } as const;
const HASH_VERSION = "s1";

/** 本地用户（前端可见形状：与 Supabase User 的 id/email 字段对齐，组件改造面最小） */
export type LocalUser = {
  id: string;
  email: string;
  name: string | null;
};

/** 业务错误：路由层按 code 映射 HTTP 状态码 */
export class AuthError extends Error {
  constructor(
    public code: "EMAIL_EXISTS" | "INVALID_CREDENTIALS" | "INVALID_INPUT",
    message: string,
  ) {
    super(message);
  }
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * 解析 Cookie 请求头为键值表。
 * 不依赖 Next 的 Request.cookies 扩展（单测的裸 Request 没有该扩展），
 * 路由守卫 / route handler / 中间件均可复用。
 */
export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key) out[key] = value;
  }
  return out;
}

// ---- 密码哈希 ----

/** scrypt 哈希，格式 s1$<saltB64>$<hashB64>（带版本前缀便于未来迁移算法） */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEY_LEN, SCRYPT_OPTS);
  return `${HASH_VERSION}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

/** 常量时间比较（含格式校验；畸形存储直接返回 false） */
export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== HASH_VERSION) return false;
  const salt = Buffer.from(parts[1], "base64");
  const expected = Buffer.from(parts[2], "base64");
  const actual = scryptSync(password, salt, expected.length, SCRYPT_OPTS);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// 用户不存在时用于"假验证"的固定哈希：抹平用户存在与否的响应时间差，防枚举
const DUMMY_HASH = hashPassword(randomBytes(16).toString("hex"));

// ---- 用户与会话 ----

/** 注册：邮箱唯一（NOCASE 排序规则不区分大小写），密码最短 8 位 */
export function createUser(
  db: Database.Database,
  email: string,
  password: string,
  name?: string | null,
): LocalUser {
  const normalized = email.trim().toLowerCase();
  if (!isValidEmail(normalized)) throw new AuthError("INVALID_INPUT", "邮箱格式不正确");
  if (password.length < MIN_PASSWORD_LENGTH)
    throw new AuthError("INVALID_INPUT", `密码至少 ${MIN_PASSWORD_LENGTH} 位`);

  const exists = db.prepare("SELECT id FROM users WHERE email = ?").get(normalized);
  if (exists) throw new AuthError("EMAIL_EXISTS", "该邮箱已注册");

  const id = newId();
  const now = isoNow();
  db.prepare(
    "INSERT INTO users (id, email, passwordHash, name, createdAt, updatedAt) VALUES (?,?,?,?,?,?)",
  ).run(id, normalized, hashPassword(password), name ?? null, now, now);
  return { id, email: normalized, name: name ?? null };
}

/** 登录：邮箱大小写不敏感；失败统一抛 INVALID_CREDENTIALS（不区分"无此用户/密码错误"） */
export function loginUser(db: Database.Database, email: string, password: string): LocalUser {
  const row = db
    .prepare("SELECT id, email, name, passwordHash FROM users WHERE email = ?")
    .get(email.trim().toLowerCase()) as
    | { id: string; email: string; name: string | null; passwordHash: string }
    | undefined;
  if (!row) {
    verifyPassword(password, DUMMY_HASH); // 固定假哈希耗时，防时间侧信道枚举
    throw new AuthError("INVALID_CREDENTIALS", "邮箱或密码错误");
  }
  if (!verifyPassword(password, row.passwordHash)) {
    throw new AuthError("INVALID_CREDENTIALS", "邮箱或密码错误");
  }
  return { id: row.id, email: row.email, name: row.name };
}

/** 创建会话：返回随机 token（同时作为 cookie 值），过期时间 30 天 */
export function createSession(db: Database.Database, userId: string): string {
  const token = randomBytes(32).toString("hex");
  // 单次时钟读取：createdAt 与 expiresAt 同源派生，
  // 保证库中 TTL 恰为 30 天（此前两次独立 Date.now() 跨 1ms 会导致 TTL 少 1ms）
  const now = Date.now();
  const createdAt = new Date(now).toISOString();
  const expiresAt = new Date(now + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  db.prepare("INSERT INTO sessions (id, userId, createdAt, expiresAt) VALUES (?,?,?,?)").run(
    token,
    userId,
    createdAt,
    expiresAt,
  );
  // 顺手清理该用户已过期会话（会话表保持精简）
  db.prepare("DELETE FROM sessions WHERE userId = ? AND expiresAt <= ?").run(userId, isoNow());
  return token;
}

/** 按 token 查有效会话 → 用户；过期会话顺带删除 */
export function getSessionUser(db: Database.Database, token: string | undefined | null): LocalUser | null {
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT u.id, u.email, u.name, s.expiresAt
       FROM sessions s JOIN users u ON u.id = s.userId
       WHERE s.id = ?`,
    )
    .get(token) as { id: string; email: string; name: string | null; expiresAt: string } | undefined;
  if (!row) return null;
  if (row.expiresAt <= isoNow()) {
    db.prepare("DELETE FROM sessions WHERE id = ?").run(token);
    return null;
  }
  return { id: row.id, email: row.email, name: row.name };
}

/** 注销：删除会话行（token 立即失效） */
export function deleteSession(db: Database.Database, token: string | undefined | null): void {
  if (!token) return;
  db.prepare("DELETE FROM sessions WHERE id = ?").run(token);
}

/** 会话 cookie 选项（httpOnly 防 XSS 窃取；sameSite=lax 防 CSRF；生产加 secure） */
export function sessionCookieOptions(): {
  httpOnly: boolean;
  sameSite: "lax";
  secure: boolean;
  path: string;
  maxAge: number;
} {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_DAYS * 24 * 60 * 60,
  };
}
