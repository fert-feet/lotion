import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
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

// ---- fake supabase ----

function mockSupabase(script: Array<() => unknown>) {
  const calls: Array<Record<string, unknown>> = [];
  const query: Record<string, unknown> = {
    select: () => query,
    eq: (col: string, val: unknown) => {
      calls.push({ op: "eq", col, val });
      return query;
    },
    ilike: (col: string, val: unknown) => {
      calls.push({ op: "ilike", col, val });
      return query;
    },
    order: () => query,
    limit: () => query,
    single: () => query,
    insert: (fields: unknown) => {
      calls.push({ op: "insert", fields });
      return query;
    },
    update: (fields: unknown) => {
      calls.push({ op: "update", fields });
      return query;
    },
    then(resolve: (v: unknown) => void) {
      resolve(script.shift()?.() ?? { data: null, error: null });
    },
  };
  return {
    supabase: { from: () => query } as unknown as SupabaseClient,
    calls,
  };
}

/** 收集工具副作用事件的 onEvent 桩 */
function collectEvents() {
  const events: ToolEvent[] = [];
  return { events, onEvent: (e: ToolEvent) => events.push(e) };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---- createNote ----

describe("createNote 工具", () => {
  it("创建成功：写入 blocks、上报 note_created + reference 事件", async () => {
    const { supabase } = mockSupabase([() => ({ data: { id: "doc-1" }, error: null })]);
    const { events, onEvent } = collectEvents();
    const t = createCreateNoteTool(supabase, "u1", onEvent);
    const result = await t.execute({ title: "标题", content: "# 一级标题\n内容" } as never, {} as never);

    expect(result).toContain("已创建");
    expect(events).toEqual([
      { type: "note_created", noteId: "doc-1" },
      { type: "reference", noteId: "doc-1", title: "一级标题" },
    ]);
  });

  it("同一实例重复创建被拒绝（闭包幂等防重，按请求隔离）", async () => {
    const { supabase } = mockSupabase([() => ({ data: { id: "doc-1" }, error: null })]);
    const t = createCreateNoteTool(supabase, "u1");
    const first = await t.execute({ title: "x", content: "y" } as never, {} as never);
    expect(first).toContain("已创建");

    const second = await t.execute({ title: "x2", content: "y2" } as never, {} as never);
    expect(second).toContain("不要重复创建");
  });

  it("不同实例（不同请求）互不影响，可各自创建", async () => {
    const { supabase } = mockSupabase([
      () => ({ data: { id: "doc-1" }, error: null }),
      () => ({ data: { id: "doc-2" }, error: null }),
    ]);
    const t1 = createCreateNoteTool(supabase, "u1");
    const t2 = createCreateNoteTool(supabase, "u1");
    const r1 = await t1.execute({ title: "x", content: "y" } as never, {} as never);
    const r2 = await t2.execute({ title: "x2", content: "y2" } as never, {} as never);
    expect(r1).toContain("已创建");
    expect(r2).toContain("已创建");
  });

  it("插入失败返回错误文案且不上报事件", async () => {
    const { supabase } = mockSupabase([() => ({ data: null, error: { message: "db down" } })]);
    const { events, onEvent } = collectEvents();
    const t = createCreateNoteTool(supabase, "u1", onEvent);
    const result = await t.execute({ title: "x", content: "y" } as never, {} as never);

    expect(result).toContain("创建笔记失败");
    expect(events).toHaveLength(0);
  });
});

// ---- readNote ----

describe("readNote 工具", () => {
  it("读取成功但不记录引用来源（只有写操作才展示胶囊）", async () => {
    const { supabase, calls } = mockSupabase([
      () => ({ data: { title: "目标笔记", content: "正文" }, error: null }),
    ]);
    const t = createReadNoteTool(supabase, "u1");
    const result = await t.execute({ noteId: "doc-1" } as never, {} as never);

    expect(result).toContain("目标笔记");
    // 按 id + userId 过滤，防止跨用户读取（RLS 之外的纵深防御）
    expect(calls).toContainEqual({ op: "eq", col: "id", val: "doc-1" });
    expect(calls).toContainEqual({ op: "eq", col: "userId", val: "u1" });
  });

  it("笔记不存在时返回提示", async () => {
    const { supabase } = mockSupabase([() => ({ data: null, error: { message: "nf" } })]);
    const t = createReadNoteTool(supabase, "u1");
    const result = await t.execute({ noteId: "missing" } as never, {} as never);

    expect(result).toContain("不存在");
  });

  it("超长内容截断返回并提示全文长度", async () => {
    const long = "字".repeat(9000);
    const { supabase } = mockSupabase([
      () => ({ data: { title: "长文档", content: JSON.stringify([{ content: [{ text: long }] }]) }, error: null }),
    ]);
    const t = createReadNoteTool(supabase, "u1");
    const result = await t.execute({ noteId: "doc-1" } as never, {} as never);

    expect(result).toContain("全文共 9000 字符");
    expect((result as string).length).toBeLessThan(8600);
  });
});

// ---- updateNote ----

describe("updateNote 工具", () => {
  it("更新成功：content 转 blocks、上报 note_modified + reference 事件", async () => {
    const { supabase, calls } = mockSupabase([
      () => ({ data: { title: "目标笔记" }, error: null }),
    ]);
    const { events, onEvent } = collectEvents();
    const t = createUpdateNoteTool(supabase, "u1", onEvent);
    const result = await t.execute({ noteId: "doc-1", content: "新内容" } as never, {} as never);

    expect(result).toBe("笔记内容已更新。");
    expect(events).toEqual([
      { type: "note_modified", noteId: "doc-1" },
      { type: "reference", noteId: "doc-1", title: "目标笔记" },
    ]);
    const updateCall = calls.find((c) => c.op === "update");
    expect(updateCall?.fields).toEqual({
      content: expect.stringContaining("新内容"),
    });
    // 写操作按 id + userId 过滤，防止跨用户修改
    expect(calls).toContainEqual({ op: "eq", col: "id", val: "doc-1" });
    expect(calls).toContainEqual({ op: "eq", col: "userId", val: "u1" });
  });

  it("内容以 # 一级标题开头时提取为文档 title", async () => {
    const { supabase, calls } = mockSupabase([
      () => ({ data: { title: "新标题" }, error: null }),
    ]);
    const t = createUpdateNoteTool(supabase, "u1");
    await t.execute({ noteId: "doc-1", content: "# 新标题\n正文" } as never, {} as never);

    const updateCall = calls.find((c) => c.op === "update");
    expect(updateCall?.fields).toEqual(
      expect.objectContaining({ title: "新标题" })
    );
  });

  it("更新失败返回错误文案且不上报事件", async () => {
    const { supabase } = mockSupabase([() => ({ error: { message: "db down" } })]);
    const { events, onEvent } = collectEvents();
    const t = createUpdateNoteTool(supabase, "u1", onEvent);
    const result = await t.execute({ noteId: "doc-1", content: "x" } as never, {} as never);

    expect(result).toContain("更新失败");
    expect(events).toHaveLength(0);
  });
});

// ---- renameNote ----

describe("renameNote 工具", () => {
  it("重命名成功：上报 note_modified + reference 事件", async () => {
    const { supabase, calls } = mockSupabase([() => ({ error: null })]);
    const { events, onEvent } = collectEvents();
    const t = createRenameNoteTool(supabase, "u1", onEvent);
    const result = await t.execute({ noteId: "doc-1", title: "新标题" } as never, {} as never);

    expect(result).toContain("新标题");
    expect(events).toEqual([
      { type: "note_modified", noteId: "doc-1" },
      { type: "reference", noteId: "doc-1", title: "新标题" },
    ]);
    expect(calls).toContainEqual({ op: "update", fields: { title: "新标题" } });
    // 写操作按 id + userId 过滤，防止跨用户重命名
    expect(calls).toContainEqual({ op: "eq", col: "id", val: "doc-1" });
    expect(calls).toContainEqual({ op: "eq", col: "userId", val: "u1" });
  });

  it("重命名失败返回错误文案", async () => {
    const { supabase } = mockSupabase([() => ({ error: { message: "db down" } })]);
    const t = createRenameNoteTool(supabase, "u1");
    const result = await t.execute({ noteId: "doc-1", title: "x" } as never, {} as never);

    expect(result).toContain("重命名失败");
  });
});

// ---- deleteNote ----

describe("deleteNote 工具", () => {
  it("笔记存在时上报 confirm_delete 事件（不直接删除）", async () => {
    const { supabase } = mockSupabase([
      () => ({ data: { title: "要删除的笔记" }, error: null }),
    ]);
    const { events, onEvent } = collectEvents();
    const t = createDeleteNoteTool(supabase, "u1", onEvent);
    const result = await t.execute({ noteId: "doc-1" } as never, {} as never);

    expect(result).toContain("确认");
    expect(events).toEqual([{ type: "confirm_delete", noteId: "doc-1", title: "要删除的笔记" }]);
  });

  it("笔记不存在时返回提示且不上报事件", async () => {
    const { supabase } = mockSupabase([() => ({ data: null, error: null })]);
    const { events, onEvent } = collectEvents();
    const t = createDeleteNoteTool(supabase, "u1", onEvent);
    const result = await t.execute({ noteId: "missing" } as never, {} as never);

    expect(result).toContain("不存在");
    expect(events).toHaveLength(0);
  });
});

// ---- archiveNote ----

describe("archiveNote 工具", () => {
  it("归档成功按 id+userId 更新", async () => {
    const { supabase, calls } = mockSupabase([() => ({ error: null })]);
    const t = createArchiveNoteTool(supabase, "u1");
    const result = await t.execute({ noteId: "doc-1" } as never, {} as never);

    expect(result).toContain("已归档");
    expect(calls).toContainEqual({ op: "update", fields: { isArchived: true } });
    expect(calls).toContainEqual({ op: "eq", col: "id", val: "doc-1" });
    expect(calls).toContainEqual({ op: "eq", col: "userId", val: "u1" });
  });

  it("归档失败返回错误文案", async () => {
    const { supabase } = mockSupabase([() => ({ error: { message: "db down" } })]);
    const t = createArchiveNoteTool(supabase, "u1");
    const result = await t.execute({ noteId: "doc-1" } as never, {} as never);

    expect(result).toContain("归档失败");
  });
});

// ---- searchNotes ----

describe("searchNotes 工具", () => {
  it("服务端 ILIKE 过滤：按标题关键词查询并返回摘要", async () => {
    const { supabase, calls } = mockSupabase([
      () => ({
        data: [
          { id: "d1", title: "React 学习笔记", content: "" },
          { id: "d2", title: "前端路线图", content: "" },
        ],
        error: null,
      }),
    ]);
    const t = createSearchNotesTool(supabase, "u1");
    const result = await t.execute({ query: "react" } as never, {} as never);

    expect(result).toContain("找到 2 篇笔记");
    expect(result).toContain("React 学习笔记");
    // 过滤条件下推到数据库：不再全量拉取后在内存匹配
    expect(calls).toContainEqual({ op: "ilike", col: "title", val: "%react%" });
    expect(calls).toContainEqual({ op: "eq", col: "isArchived", val: false });
    expect(calls).toContainEqual({ op: "eq", col: "userId", val: "u1" });
  });

  it("查询串中的 LIKE 通配符被转义（防止扩大匹配范围）", async () => {
    const { supabase, calls } = mockSupabase([() => ({ data: [], error: null })]);
    const t = createSearchNotesTool(supabase, "u1");
    await t.execute({ query: "100%_完成" } as never, {} as never);

    const ilikeCall = calls.find((c) => c.op === "ilike");
    expect(ilikeCall?.val).toBe("%100\\%\\_完成%");
  });

  it("无匹配返回未找到提示", async () => {
    const { supabase } = mockSupabase([() => ({ data: [], error: null })]);
    const t = createSearchNotesTool(supabase, "u1");
    const result = await t.execute({ query: "不存在" } as never, {} as never);

    expect(result).toContain("未找到");
  });

  it("匹配结果附带纯文本摘要（截断 80 字符，BlockNote JSON 转为文本）", async () => {
    const long = "x".repeat(120);
    const { supabase } = mockSupabase([
      () => ({
        data: [{ id: "d1", title: "长文档", content: JSON.stringify([{ content: [{ text: long }] }]) }],
        error: null,
      }),
    ]);
    const t = createSearchNotesTool(supabase, "u1");
    const result = await t.execute({ query: "长" } as never, {} as never);

    expect(result).toContain("摘要: " + "x".repeat(80) + "...");
    // JSON 结构不泄漏给模型
    expect(result).not.toContain('"content"');
  });
});
