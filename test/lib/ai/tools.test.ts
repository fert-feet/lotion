import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createCreateNoteTool } from "@/lib/ai/tools/create-note";
import { createReadNoteTool } from "@/lib/ai/tools/read-note";
import { createUpdateNoteTool } from "@/lib/ai/tools/update-note";
import { createRenameNoteTool } from "@/lib/ai/tools/rename-note";
import { createDeleteNoteTool } from "@/lib/ai/tools/delete-note";
import { createArchiveNoteTool } from "@/lib/ai/tools/archive-note";
import { createSearchNotesTool } from "@/lib/ai/tools/search-notes";

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
    order: () => query,
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

beforeEach(() => {
  vi.clearAllMocks();
});

// ---- createNote ----

describe("createNote 工具", () => {
  it("创建成功：写入 blocks、设置 pendingNoteId 并记录引用", async () => {
    const { supabase } = mockSupabase([() => ({ data: { id: "doc-1" }, error: null })]);
    const pending = { current: null as string | null };
    const references: { noteId: string; title: string }[] = [];
    const t = createCreateNoteTool(supabase, "u1", pending, references);
    const result = await t.execute({ title: "标题", content: "# 一级标题\n内容" } as never, {} as never);

    expect(result).toContain("已创建");
    expect(pending.current).toBe("doc-1");
    // 写操作后记录引用（前端展示可点击胶囊）
    expect(references).toEqual([{ noteId: "doc-1", title: "一级标题" }]);
  });

  it("重复创建被拒绝（幂等防重）", async () => {
    const { supabase } = mockSupabase([]);
    const pending = { current: "existing-doc" };
    const t = createCreateNoteTool(supabase, "u1", pending);
    const result = await t.execute({ title: "x", content: "y" } as never, {} as never);

    expect(result).toContain("不要重复创建");
    expect(pending.current).toBe("existing-doc");
  });

  it("插入失败返回错误文案", async () => {
    const { supabase } = mockSupabase([() => ({ data: null, error: { message: "db down" } })]);
    const t = createCreateNoteTool(supabase, "u1", { current: null });
    const result = await t.execute({ title: "x", content: "y" } as never, {} as never);

    expect(result).toContain("创建笔记失败");
  });
});

// ---- readNote ----

describe("readNote 工具", () => {
  it("读取成功但不记录引用来源（只有写操作才展示胶囊）", async () => {
    const { supabase } = mockSupabase([
      () => ({ data: { title: "目标笔记", content: "正文" }, error: null }),
    ]);
    const references: { noteId: string; title: string }[] = [];
    const t = createReadNoteTool(supabase);
    const result = await t.execute({ noteId: "doc-1" } as never, {} as never);

    expect(result).toContain("目标笔记");
    expect(references).toHaveLength(0);
  });

  it("笔记不存在时返回提示且不记录引用", async () => {
    const { supabase } = mockSupabase([() => ({ data: null, error: { message: "nf" } })]);
    const references: { noteId: string; title: string }[] = [];
    const t = createReadNoteTool(supabase);
    const result = await t.execute({ noteId: "missing" } as never, {} as never);

    expect(result).toContain("不存在");
    expect(references).toHaveLength(0);
  });
});

// ---- updateNote ----

describe("updateNote 工具", () => {
  it("更新成功：content 转 blocks、设置 pendingModifiedNoteId 并记录引用", async () => {
    const { supabase, calls } = mockSupabase([
      () => ({ data: { title: "目标笔记" }, error: null }),
    ]);
    const pending = { current: null as string | null };
    const references: { noteId: string; title: string }[] = [];
    const t = createUpdateNoteTool(supabase, pending, references);
    const result = await t.execute({ noteId: "doc-1", content: "新内容" } as never, {} as never);

    expect(result).toBe("笔记内容已更新。");
    expect(pending.current).toBe("doc-1");
    expect(references).toEqual([{ noteId: "doc-1", title: "目标笔记" }]);
    const updateCall = calls.find((c) => c.op === "update");
    expect(updateCall?.fields).toEqual({
      content: expect.stringContaining("新内容"),
    });
  });

  it("内容以 # 一级标题开头时提取为文档 title", async () => {
    const { supabase, calls } = mockSupabase([
      () => ({ data: { title: "新标题" }, error: null }),
    ]);
    const t = createUpdateNoteTool(supabase, { current: null });
    await t.execute({ noteId: "doc-1", content: "# 新标题\n正文" } as never, {} as never);

    const updateCall = calls.find((c) => c.op === "update");
    expect(updateCall?.fields).toEqual(
      expect.objectContaining({ title: "新标题" })
    );
  });

  it("更新失败返回错误文案且不设置标记", async () => {
    const { supabase } = mockSupabase([() => ({ error: { message: "db down" } })]);
    const pending = { current: null as string | null };
    const references: { noteId: string; title: string }[] = [];
    const t = createUpdateNoteTool(supabase, pending, references);
    const result = await t.execute({ noteId: "doc-1", content: "x" } as never, {} as never);

    expect(result).toContain("更新失败");
    expect(pending.current).toBeNull();
    expect(references).toHaveLength(0);
  });
});

// ---- renameNote ----

describe("renameNote 工具", () => {
  it("重命名成功：设置 pendingModifiedNoteId 并记录引用", async () => {
    const { supabase, calls } = mockSupabase([() => ({ error: null })]);
    const pending = { current: null as string | null };
    const references: { noteId: string; title: string }[] = [];
    const t = createRenameNoteTool(supabase, pending, references);
    const result = await t.execute({ noteId: "doc-1", title: "新标题" } as never, {} as never);

    expect(result).toContain("新标题");
    expect(pending.current).toBe("doc-1");
    expect(references).toEqual([{ noteId: "doc-1", title: "新标题" }]);
    expect(calls).toContainEqual({ op: "update", fields: { title: "新标题" } });
  });

  it("重命名失败返回错误文案", async () => {
    const { supabase } = mockSupabase([() => ({ error: { message: "db down" } })]);
    const t = createRenameNoteTool(supabase, { current: null });
    const result = await t.execute({ noteId: "doc-1", title: "x" } as never, {} as never);

    expect(result).toContain("重命名失败");
  });
});

// ---- deleteNote ----

describe("deleteNote 工具", () => {
  it("笔记存在时设置待确认标记（不直接删除）", async () => {
    const { supabase } = mockSupabase([
      () => ({ data: { title: "要删除的笔记" }, error: null }),
    ]);
    const pending = { current: null as { noteId: string; title: string } | null };
    const t = createDeleteNoteTool(supabase, "u1", pending);
    const result = await t.execute({ noteId: "doc-1" } as never, {} as never);

    expect(result).toContain("确认");
    expect(pending.current).toEqual({ noteId: "doc-1", title: "要删除的笔记" });
  });

  it("笔记不存在时返回提示且不设置标记", async () => {
    const { supabase } = mockSupabase([() => ({ data: null, error: null })]);
    const pending = { current: null as { noteId: string; title: string } | null };
    const t = createDeleteNoteTool(supabase, "u1", pending);
    const result = await t.execute({ noteId: "missing" } as never, {} as never);

    expect(result).toContain("不存在");
    expect(pending.current).toBeNull();
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
  it("按标题关键词匹配（大小写不敏感）", async () => {
    const { supabase } = mockSupabase([
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

    expect(result).toContain("找到 1 篇笔记");
    expect(result).toContain("React 学习笔记");
    expect(result).not.toContain("前端路线图");
  });

  it("无匹配返回未找到提示", async () => {
    const { supabase } = mockSupabase([() => ({ data: [], error: null })]);
    const t = createSearchNotesTool(supabase, "u1");
    const result = await t.execute({ query: "不存在" } as never, {} as never);

    expect(result).toContain("未找到");
  });

  it("匹配结果附带内容摘要（截断 80 字符）", async () => {
    const long = "x".repeat(120);
    const { supabase } = mockSupabase([
      () => ({ data: [{ id: "d1", title: "长文档", content: long }], error: null }),
    ]);
    const t = createSearchNotesTool(supabase, "u1");
    const result = await t.execute({ query: "长" } as never, {} as never);

    expect(result).toContain("摘要: " + "x".repeat(80) + "...");
  });
});
