// 插件管理员（owner）判定。
//
// 本地版没有角色表；插件管理会影响整个 Node 进程（所有用户共享），
// 因此只允许**最早注册的用户**管理。这个约定不新增表/迁移，首启即生效。
//
// ⚠️ 服务端专用。
import type Database from "better-sqlite3";

/** 最早注册的用户 id；库为空时返回 null */
export function getOwnerId(db: Database.Database): string | null {
  const row = db
    .prepare('SELECT id FROM users ORDER BY createdAt ASC, id ASC LIMIT 1')
    .get() as { id: string } | undefined;
  return row?.id ?? null;
}

/** 给定用户是否 owner（库为空 / 未登录均 false） */
export function isOwner(db: Database.Database, userId: string | null | undefined): boolean {
  if (!userId) return false;
  return getOwnerId(db) === userId;
}
