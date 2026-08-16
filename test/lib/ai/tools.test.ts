// AI 工具单测：真实内存 SQLite（替代旧 fake supabase 查询链），
// 断言工具对本地库的实际读写效果（含 userId 所有权隔离）。
import { describe, expect, it, vi, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { openTestDb, newId, isoNow } from "@/lib/local/sqlite";
import {
  createDocument,
  updateDocument,
  getDocumentById,
} from "@/lib/local/db";
import { createCreateNoteTool } from "@/lib/ai/tools/create-note";
import { createReadNoteTool } from "@/lib/ai/tools/read-note";
import { createUpdateNoteTool } from "@/lib/ai/tools/update-note";
import { createRenameNoteTool } from "@/lib/ai/tools/rename-note";
import { createDeleteNoteTool } from "@/lib/ai/tools/delete-note";
import { createArchiveNoteTool } from "@/lib/ai/tools/archive-note";
import { createSearchNotesTool } from "@/lib/ai/tools/search-notes";
import type { ToolEvent } from "@/lib/ai/tools";

vi.mock("@/lib/logger", () => {
  const noop = () => {};
  const ns = new Proxy({}, { get: () => noop });
  return { logger: { api: ns, agent: ns, tools: ns, db: ns } };
});

let db: Database.Database;

/** 收集工具副作用事件的 onEvent 桩 */
function collectEvents() {
  const events: ToolEvent[] = [];
  return { events, onEvent: (e: ToolEvent) => events.push(e) };
}

/** 种子文档（默认归属 u1），返回 id */
function seedDoc(title: string, content: string, userId = "u1"): string {
  const id = createDocument(db, userId, title);
  if (content) updateDocument(db, id, { content });
  return id;
}

beforeEach(() => {
  db = openTestDb();
  // 种子用户 u1/u2（documents.userId 外键需要 users 行）
  for (const [id, email] of [
    ["u1", "u1@x.com"],
    ["u2", "u2@x.com"],
  ] as const) {
    db.prepare(
      "INSERT INTO users (id, email, passwordHash, createdAt, updatedAt) VALUES (?,?,?,?,?)",
    ).run(id, email, "hash", isoNow(), isoNow());
  }
});

// ---- createNote ----

describe("createNote 工具", () => {
  it("创建成功：写入草稿（isDraft=true）、上报 note_created + reference 事件", async () => {
    const { events, onEvent } = collectEvents();
    const t = createCreateNoteTool(db, "u1", onEvent);
    const result = await t.execute({ title: "标题", content: "# 一级标题\n内容" } as never, {} as never);

    expect(result).toContain("已创建");
    const created = events.find((e) => e.type === "note_created");
    expect(created).toBeDefined();
    const doc = getDocumentById(db, created!.noteId, "u1");
    expect(doc!.title).toBe("一级标题"); // 正文 # 一级标题提取为 title
    expect(doc!.isDraft).toBe(true);
    expect(doc!.userId).toBe("u1");
    expect(events).toContainEqual({ type: "reference", noteId: created!.noteId, title: "一级标题" });
  });

  it("同一实例重复创建被拒绝（闭包幂等防重，按请求隔离）", async () => {
    const t = createCreateNoteTool(db, "u1");
    const first = await t.execute({ title: "x", content: "y" } as never, {} as never);
    expect(first).toContain("已创建");

    const second = await t.execute({ title: "x2", content: "y2" } as never, {} as never);
    expect(second).toContain("不要重复创建");
  });

  it("不同实例（不同请求）互不影响，可各自创建", async () => {
    const t1 = createCreateNoteTool(db, "u1");
    const t2 = createCreateNoteTool(db, "u1");
    const r1 = await t1.execute({ title: "x", content: "y" } as never, {} as never);
    const r2 = await t2.execute({ title: "x2", content: "y2" } as never, {} as never);
    expect(r1).toContain("已创建");
    expect(r2).toContain("已创建");
  });
});

// ---- readNote ----

describe("readNote 工具", () => {
  it("读取成功但不记录引用来源（只有写操作才展示胶囊）", async () => {
    const id = seedDoc("目标笔记", "正文");
    const t = createReadNoteTool(db, "u1");
    const result = await t.execute({ noteId: id } as never, {} as never);

    expect(result).toContain("目标笔记");
    expect(result).toContain("正文");
  });

  it("跨用户读取被拒绝（所有权过滤）", async () => {
    const id = seedDoc("私有笔记", "秘密", "u2");
    const t = createReadNoteTool(db, "u1");
    const result = await t.execute({ noteId: id } as never, {} as never);

    expect(result).toContain("不存在");
  });

  it("笔记不存在时返回提示", async () => {
    const t = createReadNoteTool(db, "u1");
    const result = await t.execute({ noteId: newId() } as never, {} as never);

    expect(result).toContain("不存在");
  });

  it("超长内容截断返回并提示全文长度", async () => {
    const long = "字".repeat(9000);
    const id = seedDoc("长文档", JSON.stringify([{ content: [{ text: long }] }]));
    const t = createReadNoteTool(db, "u1");
    const result = await t.execute({ noteId: id } as never, {} as never);

    expect(result).toContain("全文共 9000 字符");
    expect((result as string).length).toBeLessThan(8600);
  });
});

// ---- updateNote ----

describe("updateNote 工具", () => {
  it("更新成功：content 转 blocks 落库、上报 note_modified + reference 事件", async () => {
    const id = seedDoc("目标笔记", "旧内容");
    const { events, onEvent } = collectEvents();
    const t = createUpdateNoteTool(db, "u1", onEvent);
    const result = await t.execute({ noteId: id, content: "新内容" } as never, {} as never);

    expect(result).toBe("笔记内容已更新。");
    expect(events).toEqual([
      { type: "note_modified", noteId: id },
      { type: "reference", noteId: id, title: "目标笔记" },
    ]);
    const doc = getDocumentById(db, id, "u1");
    expect(doc!.content).toContain("新内容");
  });

  it("内容以 # 一级标题开头时提取为文档 title", async () => {
    const id = seedDoc("旧标题", "旧内容");
    const t = createUpdateNoteTool(db, "u1");
    await t.execute({ noteId: id, content: "# 新标题\n正文" } as never, {} as never);

    expect(getDocumentById(db, id, "u1")!.title).toBe("新标题");
  });

  it("笔记不存在或跨用户时返回错误文案且不上报事件", async () => {
    const id = seedDoc("别人的", "x", "u2");
    const { events, onEvent } = collectEvents();
    const t = createUpdateNoteTool(db, "u1", onEvent);
    const result = await t.execute({ noteId: id, content: "x" } as never, {} as never);

    expect(result).toContain("不存在");
    expect(events).toHaveLength(0);
  });
});

// ---- renameNote ----

describe("renameNote 工具", () => {
  it("重命名成功：标题落库、上报 note_modified + reference 事件", async () => {
    const id = seedDoc("旧标题", "");
    const { events, onEvent } = collectEvents();
    const t = createRenameNoteTool(db, "u1", onEvent);
    const result = await t.execute({ noteId: id, title: "新标题" } as never, {} as never);

    expect(result).toContain("新标题");
    expect(events).toEqual([
      { type: "note_modified", noteId: id },
      { type: "reference", noteId: id, title: "新标题" },
    ]);
    expect(getDocumentById(db, id, "u1")!.title).toBe("新标题");
  });

  it("笔记不存在时返回错误文案", async () => {
    const t = createRenameNoteTool(db, "u1");
    const result = await t.execute({ noteId: newId(), title: "x" } as never, {} as never);

    expect(result).toContain("不存在");
  });
});

// ---- deleteNote ----

describe("deleteNote 工具", () => {
  it("笔记存在时上报 confirm_delete 事件（不直接删除）", async () => {
    const id = seedDoc("要删除的笔记", "");
    const { events, onEvent } = collectEvents();
    const t = createDeleteNoteTool(db, "u1", onEvent);
    const result = await t.execute({ noteId: id } as never, {} as never);

    expect(result).toContain("确认");
    expect(events).toEqual([{ type: "confirm_delete", noteId: id, title: "要删除的笔记" }]);
    // 未被真正删除
    expect(getDocumentById(db, id, "u1")).not.toBeNull();
  });

  it("笔记不存在时返回提示且不上报事件", async () => {
    const { events, onEvent } = collectEvents();
    const t = createDeleteNoteTool(db, "u1", onEvent);
    const result = await t.execute({ noteId: newId() } as never, {} as never);

    expect(result).toContain("不存在");
    expect(events).toHaveLength(0);
  });
});

// ---- archiveNote ----

describe("archiveNote 工具", () => {
  it("归档成功：isArchived 置 1（只影响单条，不递归）", async () => {
    const parent = seedDoc("父笔记", "");
    const child = createDocument(db, "u1", "子笔记", parent);
    const t = createArchiveNoteTool(db, "u1");
    const result = await t.execute({ noteId: parent } as never, {} as never);

    expect(result).toContain("已归档");
    expect(getDocumentById(db, parent, "u1")!.isArchived).toBe(true);
    expect(getDocumentById(db, child, "u1")!.isArchived).toBe(false);
  });

  it("归档失败（不存在/跨用户）返回错误文案", async () => {
    const t = createArchiveNoteTool(db, "u1");
    const result = await t.execute({ noteId: newId() } as never, {} as never);

    expect(result).toContain("归档失败");
  });
});

// ---- searchNotes ----

describe("searchNotes 工具", () => {
  it("标题 LIKE 过滤（ASCII 大小写不敏感），只搜当前用户", async () => {
    seedDoc("React 学习笔记", "");
    seedDoc("前端路线图", "");
    seedDoc("别人的 React 笔记", "", "u2"); // 不应出现在结果中
    const t = createSearchNotesTool(db, "u1");
    const result = await t.execute({ query: "react" } as never, {} as never);

    expect(result).toContain("找到 1 篇笔记");
    expect(result).toContain("React 学习笔记");
    expect(result).not.toContain("别人的");
  });

  it("查询串中的 LIKE 通配符被转义（防止扩大匹配范围）", async () => {
    seedDoc("100%_完成", "");
    seedDoc("100X完成", "");
    const t = createSearchNotesTool(db, "u1");
    const result = await t.execute({ query: "100%_完成" } as never, {} as never);

    expect(result).toContain("100%_完成");
    expect(result).not.toContain("100X完成");
  });

  it("无匹配返回未找到提示", async () => {
    const t = createSearchNotesTool(db, "u1");
    const result = await t.execute({ query: "不存在" } as never, {} as never);

    expect(result).toContain("未找到");
  });

  it("匹配结果附带纯文本摘要（截断 80 字符，BlockNote JSON 转为文本）", async () => {
    const long = "x".repeat(120);
    seedDoc("长文档", JSON.stringify([{ content: [{ text: long }] }]));
    const t = createSearchNotesTool(db, "u1");
    const result = await t.execute({ query: "长文档" } as never, {} as never);

    expect(result).toContain("摘要: " + "x".repeat(80) + "...");
    // JSON 结构不泄漏给模型
    expect(result).not.toContain('"content"');
  });
});
