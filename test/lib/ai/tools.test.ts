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
import { createListNotesTool } from "@/lib/ai/tools/list-notes";
import { createMoveNoteTool } from "@/lib/ai/tools/move-note";
import { createRestoreNoteTool } from "@/lib/ai/tools/restore-note";
import { createListTrashTool } from "@/lib/ai/tools/list-trash";
import { createPublishNoteTool } from "@/lib/ai/tools/publish-note";
import { createSetNoteIconTool } from "@/lib/ai/tools/set-note-icon";
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

  it("指定 parentDocumentId 时创建为子笔记；父文档无效/已归档时拒绝", async () => {
    const parent = seedDoc("父笔记", "");
    const t = createCreateNoteTool(db, "u1");
    const result = await t.execute({ title: "子", content: "内容", parentDocumentId: parent } as never, {} as never);
    expect(result).toContain("已创建");
    const createdId = (result as string).match(/ID: ([0-9a-f-]+)/)![1];
    expect(getDocumentById(db, createdId, "u1")!.parentDocument).toBe(parent);

    // 父文档不存在
    const t2 = createCreateNoteTool(db, "u1");
    const bad = await t2.execute({ title: "x", content: "y", parentDocumentId: newId() } as never, {} as never);
    expect(bad).toContain("父笔记");

    // 父文档已归档
    const archivedParent = seedDoc("归档父", "");
    const archiver = createArchiveNoteTool(db, "u1");
    await archiver.execute({ noteId: archivedParent } as never, {} as never);
    const t3 = createCreateNoteTool(db, "u1");
    const bad2 = await t3.execute({ title: "x", content: "y", parentDocumentId: archivedParent } as never, {} as never);
    expect(bad2).toContain("父笔记");
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
  it("读取成功即上报 reference 事件（AI 读过的笔记都算引用来源）", async () => {
    const id = seedDoc("目标笔记", "正文");
    const { events, onEvent } = collectEvents();
    const t = createReadNoteTool(db, "u1", onEvent);
    const result = await t.execute({ noteId: id } as never, {} as never);

    expect(result).toContain("目标笔记");
    expect(result).toContain("正文");
    expect(events).toContainEqual({ type: "reference", noteId: id, title: "目标笔记" });
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
      { type: "note_modified", noteId: id, title: "目标笔记" },
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
      { type: "note_modified", noteId: id, title: "新标题" },
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

  it("正文命中：标题不含关键词但内容含时也能搜到", async () => {
    const id = seedDoc("Untitled", JSON.stringify([{ content: [{ text: "会议纪要：讨论 Q3 计划" }] }]));
    const t = createSearchNotesTool(db, "u1");
    const result = await t.execute({ query: "会议纪要" } as never, {} as never);

    expect(result).toContain("找到 1 篇笔记");
    expect(result).toContain(id);
    expect(result).toContain("摘要: 会议纪要");
  });

  it("不传关键词时返回全部未归档笔记（按最近更新排序）", async () => {
    seedDoc("第一篇", "");
    seedDoc("第二篇", "");
    const t = createSearchNotesTool(db, "u1");
    const result = await t.execute({} as never, {} as never);

    expect(result).toContain("找到 2 篇笔记");
    expect(result).toContain("第一篇");
    expect(result).toContain("第二篇");
  });

  it("空关键词且无任何笔记时返回空提示", async () => {
    const t = createSearchNotesTool(db, "u1");
    const result = await t.execute({ query: "" } as never, {} as never);
    expect(result).toContain("当前没有任何笔记");
  });
});

// ---- listNotes ----

describe("listNotes 工具", () => {
  it("列出全部根级未归档笔记（含子文档数），子文档不出现在全量视图", async () => {
    const parent = seedDoc("父笔记", "正文");
    createDocument(db, "u1", "子笔记", parent); // 子文档只在父文档视图出现
    seedDoc("独立笔记", "");
    const t = createListNotesTool(db, "u1");
    const result = await t.execute({} as never, {} as never);

    expect(result).toContain("找到 2 篇笔记");
    expect(result).toContain("父笔记");
    expect(result).toContain("（含 1 篇子笔记）");
    expect(result).not.toContain("- 子笔记"); // 子文档不以独立行出现，仅体现在父文档的计数里
    expect(result).not.toContain("正文");
  });

  it("指定 parentDocumentId 只列出其直接子文档", async () => {
    const parent = seedDoc("父笔记", "");
    createDocument(db, "u1", "子1", parent);
    createDocument(db, "u1", "子2", parent);
    seedDoc("无关笔记", "");
    const t = createListNotesTool(db, "u1");
    const result = await t.execute({ parentDocumentId: parent } as never, {} as never);

    expect(result).toContain("找到 2 篇笔记");
    expect(result).toContain("子1");
    expect(result).toContain("子2");
    expect(result).not.toContain("无关笔记");
  });

  it("空库/无子文档时返回对应提示", async () => {
    const t1 = createListNotesTool(db, "u1");
    expect(await t1.execute({} as never, {} as never)).toContain("没有任何笔记");

    const parent = seedDoc("父", "");
    const t2 = createListNotesTool(db, "u1");
    expect(await t2.execute({ parentDocumentId: parent } as never, {} as never)).toContain("没有子笔记");
  });
});

// ---- moveNote ----

describe("moveNote 工具", () => {
  it("移动到目标父笔记下，上报 note_modified + reference 事件", async () => {
    const target = seedDoc("目标父", "");
    const moving = seedDoc("要移动的", "");
    const { events, onEvent } = collectEvents();
    const t = createMoveNoteTool(db, "u1", onEvent);
    const result = await t.execute({ noteId: moving, newParentId: target } as never, {} as never);

    expect(result).toContain("已移动");
    expect(getDocumentById(db, moving, "u1")!.parentDocument).toBe(target);
    expect(events).toEqual([
      { type: "note_modified", noteId: moving, title: "要移动的" },
      { type: "reference", noteId: moving, title: "要移动的" },
    ]);
  });

  it("newParentId 传 null 移到根目录", async () => {
    const target = seedDoc("目标父", "");
    const moving = createDocument(db, "u1", "要移动的", target);
    const t = createMoveNoteTool(db, "u1");
    const result = await t.execute({ noteId: moving, newParentId: null } as never, {} as never);

    expect(result).toContain("根目录");
    expect(getDocumentById(db, moving, "u1")!.parentDocument).toBeNull();
  });

  it("防循环：不能移动到自身子笔记下", async () => {
    const parent = seedDoc("父", "");
    const child = createDocument(db, "u1", "子", parent);
    const t = createMoveNoteTool(db, "u1");
    const result = await t.execute({ noteId: parent, newParentId: child } as never, {} as never);

    expect(result).toContain("循环");
    expect(getDocumentById(db, parent, "u1")!.parentDocument).toBeNull();
  });

  it("目标不存在/已归档/跨用户时拒绝且不上报事件", async () => {
    const moving = seedDoc("要移动的", "");
    const foreign = seedDoc("别人的父", "", "u2");
    const archived = seedDoc("归档父", "");
    const archiver = createArchiveNoteTool(db, "u1");
    await archiver.execute({ noteId: archived } as never, {} as never);

    const { events, onEvent } = collectEvents();
    const t = createMoveNoteTool(db, "u1", onEvent);

    expect(await t.execute({ noteId: moving, newParentId: newId() } as never, {} as never)).toContain("不存在");
    expect(await t.execute({ noteId: moving, newParentId: foreign } as never, {} as never)).toContain("不存在");
    expect(await t.execute({ noteId: moving, newParentId: archived } as never, {} as never)).toContain("已归档");
    expect(events).toHaveLength(0);
  });
});

// ---- restoreNote / listTrash ----

describe("restoreNote 工具", () => {
  it("从回收站恢复，上报 note_modified + reference 事件", async () => {
    const id = seedDoc("要恢复的", "");
    const archiver = createArchiveNoteTool(db, "u1");
    await archiver.execute({ noteId: id } as never, {} as never);
    expect(getDocumentById(db, id, "u1")!.isArchived).toBe(true);

    const { events, onEvent } = collectEvents();
    const t = createRestoreNoteTool(db, "u1", onEvent);
    const result = await t.execute({ noteId: id } as never, {} as never);

    expect(result).toContain("已从回收站恢复");
    expect(getDocumentById(db, id, "u1")!.isArchived).toBe(false);
    expect(events).toContainEqual({ type: "note_modified", noteId: id, title: "要恢复的" });
  });

  it("不在回收站/不存在时给出提示且不上报事件", async () => {
    const active = seedDoc("正常笔记", "");
    const { events, onEvent } = collectEvents();
    const t = createRestoreNoteTool(db, "u1", onEvent);

    expect(await t.execute({ noteId: active } as never, {} as never)).toContain("不在回收站");
    expect(await t.execute({ noteId: newId() } as never, {} as never)).toContain("不存在");
    expect(events).toHaveLength(0);
  });
});

describe("listTrash 工具", () => {
  it("列出回收站中的笔记", async () => {
    const a = seedDoc("回收的 A", "");
    seedDoc("正常的 B", "");
    const archiver = createArchiveNoteTool(db, "u1");
    await archiver.execute({ noteId: a } as never, {} as never);

    const t = createListTrashTool(db, "u1");
    const result = await t.execute({} as never, {} as never);

    expect(result).toContain("回收站中有 1 篇笔记");
    expect(result).toContain("回收的 A");
    expect(result).not.toContain("正常的 B");
  });

  it("回收站为空时返回提示", async () => {
    const t = createListTrashTool(db, "u1");
    const result = await t.execute({} as never, {} as never);
    expect(result).toContain("回收站是空的");
  });
});

// ---- publishNote ----

describe("publishNote 工具", () => {
  it("发布与取消发布，上报 note_modified + reference 事件", async () => {
    const id = seedDoc("待发布", "");
    const { events, onEvent } = collectEvents();
    const t = createPublishNoteTool(db, "u1", onEvent);

    const published = await t.execute({ noteId: id, published: true } as never, {} as never);
    expect(published).toContain("已发布");
    expect(getDocumentById(db, id, "u1")!.isPublished).toBe(true);

    const unpublished = await t.execute({ noteId: id, published: false } as never, {} as never);
    expect(unpublished).toContain("取消发布");
    expect(getDocumentById(db, id, "u1")!.isPublished).toBe(false);

    expect(events.filter((e) => e.type === "note_modified")).toHaveLength(2);
  });

  it("重复设置同一状态时提示已处于该状态（不重复落库）", async () => {
    const id = seedDoc("待发布", "");
    updateDocument(db, id, { isPublished: true }); // 预置为已发布
    const t = createPublishNoteTool(db, "u1");
    const result = await t.execute({ noteId: id, published: true } as never, {} as never);
    expect(result).toContain("已处于发布状态");
  });

  it("笔记不存在时返回错误文案", async () => {
    const t = createPublishNoteTool(db, "u1");
    const result = await t.execute({ noteId: newId(), published: true } as never, {} as never);
    expect(result).toContain("不存在");
  });
});

// ---- setNoteIcon ----

describe("setNoteIcon 工具", () => {
  it("设置 emoji 图标并上报事件", async () => {
    const id = seedDoc("带图标的", "");
    const { events, onEvent } = collectEvents();
    const t = createSetNoteIconTool(db, "u1", onEvent);
    const result = await t.execute({ noteId: id, icon: "📚" } as never, {} as never);

    expect(result).toContain("📚");
    expect(getDocumentById(db, id, "u1")!.icon).toBe("📚");
    expect(events).toContainEqual({ type: "note_modified", noteId: id, title: "带图标的" });
  });

  it("空字符串清除图标", async () => {
    const id = seedDoc("清图标", "");
    updateDocument(db, id, { icon: "📚" });
    const t = createSetNoteIconTool(db, "u1");
    const result = await t.execute({ noteId: id, icon: "  " } as never, {} as never);

    expect(result).toContain("清除");
    expect(getDocumentById(db, id, "u1")!.icon).toBeNull();
  });

  it("笔记不存在时返回错误文案", async () => {
    const t = createSetNoteIconTool(db, "u1");
    const result = await t.execute({ noteId: newId(), icon: "📚" } as never, {} as never);
    expect(result).toContain("不存在");
  });
});