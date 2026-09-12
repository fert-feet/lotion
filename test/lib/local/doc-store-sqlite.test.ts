import { mount } from "@/test/mocks/mount";
// docStore 宿主侧实现单测：:memory: 真实 SQL 走一遍契约（防"接缝只有壳、语义走样"）。
import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { openTestDb, initDatabase, isoNow } from "@/lib/local/sqlite";
import { createSqliteDocStore } from "@/lib/local/doc-store-sqlite";
import type { Actor } from "@/lib/seams/doc-store";
import { createRootContext } from "@/lib/kernel";

const actor: Actor = { userId: "user-1" };
const other: Actor = { userId: "user-2" };

let db: Database.Database;

beforeEach(() => {
  db = openTestDb();
  initDatabase(db);
  for (const id of ["user-1", "user-2"]) {
    db.prepare(
      "INSERT INTO users (id, email, passwordHash, createdAt, updatedAt) VALUES (?,?,?,?,?)",
    ).run(id, `${id}@example.com`, "hash", isoNow(), isoNow());
  }
});

describe("lib/local/doc-store-sqlite", () => {
  it("文档 CRUD 全链路：创建 → 读取 → 列表 → 更新 → 移动 → 归档 → 恢复 → 删除", async () => {
    const store = createSqliteDocStore(db);

    const rootId = await store.create(actor, "根文档");
    const childId = await store.create(actor, "子文档", rootId);

    expect((await store.getById(actor, rootId))?.title).toBe("根文档");
    expect((await store.listSidebar(actor, null)).map((d) => d.id)).toEqual([rootId]);
    expect((await store.listSidebar(actor, rootId)).map((d) => d.id)).toEqual([childId]);

    await store.update(actor, rootId, { content: "正文", icon: "📘" });
    const updated = await store.getById(actor, rootId, { fresh: true });
    expect(updated?.content).toBe("正文");
    expect(updated?.icon).toBe("📘");

    await store.move(actor, childId, null);
    expect((await store.listSidebar(actor, null)).map((d) => d.id).sort()).toEqual(
      [rootId, childId].sort(),
    );

    await store.archive(actor, childId);
    expect((await store.listTrash(actor)).map((d) => d.id)).toEqual([childId]);
    await store.restore(actor, childId);
    expect(await store.listTrash(actor)).toEqual([]);

    await store.remove(actor, childId);
    expect(await store.getById(actor, childId)).toBeNull();
  });

  it("listOverview 带子文档数（AI 浏览类工具的消费面）", async () => {
    const store = createSqliteDocStore(db);
    const parent = await store.create(actor, "父");
    await store.create(actor, "子1", parent);
    await store.create(actor, "子2", parent);

    const overview = await store.listOverview(actor, null);

    expect(overview).toHaveLength(1);
    expect(overview[0]).toMatchObject({ id: parent, title: "父", childCount: 2 });
  });

  it("Actor 隔离：另一个用户看不到、也动不了别人的文档", async () => {
    const store = createSqliteDocStore(db);
    const mine = await store.create(actor, "我的");

    expect(await store.getById(other, mine)).toBeNull();
    expect(await store.listSidebarAll(other)).toEqual([]);
    expect(await store.listTrash(other)).toEqual([]);
  });

  it("AI 会话：创建 / 历史 / 消息写入（userId 由 Actor 注入）/ 改名 / 触摸", async () => {
    const store = createSqliteDocStore(db);
    const sessionId = await store.createChatSession(actor, "新对话");

    await store.insertChatMessage(actor, { sessionId, role: "user", content: "你好" });
    await store.insertChatMessage(actor, {
      sessionId,
      role: "assistant",
      content: "你好呀",
      totalTokens: 12,
    });

    const history = await store.listChatHistory(actor, sessionId);
    expect(history.map((m) => m.content)).toEqual(["你好", "你好呀"]);

    await store.setChatSessionTitle(actor, sessionId, "问候");
    await store.touchChatSession(actor, sessionId);
    expect((await store.listChatSessions(actor))[0]).toMatchObject({ id: sessionId, title: "问候" });

    await store.deleteChatSession(actor, sessionId);
    expect(await store.listChatSessions(actor)).toEqual([]);
  });

  it("清理图标/封面走同一契约", async () => {
    const store = createSqliteDocStore(db);
    const id = await store.create(actor, "带图标");
    await store.update(actor, id, { icon: "🔥", coverImage: "/uploads/x.png" });

    await store.removeIcon(actor, id);
    await store.removeCoverImage(actor, id);

    const doc = await store.getById(actor, id, { fresh: true });
    expect(doc?.icon).toBeNull();
    expect(doc?.coverImage).toBeNull();
  });
});

describe("lib/local/doc-store-sqlite 装配插件", () => {
  it("sqliteDocStorePlugin 可注入测试库：挂载即可用，卸载即消失", async () => {
    const { sqliteDocStorePlugin } = await import("@/lib/local/doc-store-sqlite");
    const { requireDocStore, findDocStore } = await import("@/lib/seams/doc-store");

    const ctx = createRootContext();
    const fiber = await mount(ctx, sqliteDocStorePlugin, { db });

    const id = await requireDocStore(ctx).create(actor, "插件装配的文档");
    expect((await requireDocStore(ctx).getById(actor, id))?.title).toBe("插件装配的文档");

    await fiber.dispose();
    expect(findDocStore(ctx)).toBeUndefined();
  });
});
