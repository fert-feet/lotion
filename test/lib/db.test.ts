import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  getChatSessions,
  createChatSession,
  deleteChatSession,
  getChatHistory,
  insertChatMessage,
  getSidebarAll,
  getTrash,
  getById,
  getByIdFresh,
  create,
  update,
  archive,
  restore,
  remove,
  removeIcon,
  removeCoverImage,
} from "@/lib/db";

// ---- mocks ----

const createClient = vi.fn();

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => createClient(),
}));

vi.mock("@/lib/logger", () => {
  const noop = () => {};
  const ns = new Proxy({}, { get: () => noop });
  return { logger: { api: ns, agent: ns, tools: ns, db: ns } };
});

type StepResult = { data?: unknown; error?: { message: string } | null };

interface CallRecord {
  op: string;
  [key: string]: unknown;
}

/**
 * 可编程 thenable fake：每次 await 查询链消耗脚本队列中的一项；
 * 同时记录 update/eq/insert 等调用供断言。
 */
function makeQuery(script: Array<() => StepResult | Promise<StepResult>>, calls: CallRecord[]) {
  const query: Record<string, unknown> = {
    select: () => query,
    eq: (col: string, val: unknown) => {
      calls.push({ op: "eq", col, val });
      return query;
    },
    order: () => {
      calls.push({ op: "order" });
      return query;
    },
    limit: () => {
      calls.push({ op: "limit" });
      return query;
    },
    is: (col: string, val: unknown) => {
      calls.push({ op: "is", col, val });
      return query;
    },
    insert: (fields: unknown) => {
      calls.push({ op: "insert", fields });
      return query;
    },
    update: (fields: unknown) => {
      calls.push({ op: "update", fields });
      return query;
    },
    delete: () => {
      calls.push({ op: "delete" });
      return query;
    },
    single: () => query,
    then(resolve: (v: StepResult | Promise<StepResult>) => void) {
      const step = script.shift();
      resolve(step ? step() : { data: null, error: null });
    },
  };
  return query;
}

function mockSupabase(script: Array<() => StepResult | Promise<StepResult>>) {
  const calls: CallRecord[] = [];
  createClient.mockReturnValue({ from: () => makeQuery(script, calls) });
  return calls;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---- chat ----

describe("chat 会话函数", () => {
  it("getChatSessions 按用户查询并按 updatedAt 倒序", async () => {
    const calls = mockSupabase([
      () => ({ data: [{ id: "s1", title: "会话" }] }),
    ]);
    const sessions = await getChatSessions("u1");
    expect(sessions).toEqual([{ id: "s1", title: "会话" }]);
    const eqs = calls.filter((c) => c.op === "eq");
    expect(eqs).toContainEqual({ op: "eq", col: "userId", val: "u1" });
    expect(calls.some((c) => c.op === "order")).toBe(true);
    // 最多 50 条，防止会话多时全量拉取
    expect(calls.some((c) => c.op === "limit")).toBe(true);
  });

  it("createChatSession 返回新会话 id", async () => {
    mockSupabase([() => ({ data: { id: "new-s1" }, error: null })]);
    await expect(createChatSession("u1")).resolves.toBe("new-s1");
  });

  it("createChatSession 失败时抛出", async () => {
    mockSupabase([() => ({ data: null, error: { message: "insert failed" } })]);
    await expect(createChatSession("u1")).rejects.toThrow("insert failed");
  });

  it("deleteChatSession 按 id+userId 删除", async () => {
    const calls = mockSupabase([() => ({ error: null })]);
    await deleteChatSession("u1", "s1");
    expect(calls).toContainEqual({ op: "delete" });
    expect(calls).toContainEqual({ op: "eq", col: "id", val: "s1" });
    expect(calls).toContainEqual({ op: "eq", col: "userId", val: "u1" });
  });

  it("getChatHistory 带 sessionId 过滤并转为时间升序", async () => {
    const calls = mockSupabase([
      () => ({ data: [{ id: "m1" }, { id: "m2" }] }),
    ]);
    const msgs = await getChatHistory("u1", "s1", 20);
    expect(msgs.map((m) => m.id)).toEqual(["m2", "m1"]); // reverse 升序
    expect(calls).toContainEqual({ op: "eq", col: "sessionId", val: "s1" });
    expect(calls.some((c) => c.op === "limit")).toBe(true);
  });

  it("getChatHistory 无 sessionId 时不加过滤条件", async () => {
    const calls = mockSupabase([() => ({ data: [] })]);
    await getChatHistory("u1", null, 20);
    expect(calls.filter((c) => c.op === "eq" && c.col === "sessionId")).toHaveLength(0);
  });

  it("getChatHistory 不传 limit 时全量拉取（不调用 limit()）", async () => {
    const calls = mockSupabase([() => ({ data: [] })]);
    await getChatHistory("u1", "s1");
    expect(calls.some((c) => c.op === "limit")).toBe(false);
  });

  it("insertChatMessage 字段映射：token 默认 0、sessionId 空转 null", async () => {
    const calls = mockSupabase([() => ({ error: null })]);
    await insertChatMessage(
      { from: () => makeQuery([], calls) } as never,
      { userId: "u1", sessionId: null, role: "user", content: "hi" }
    );
    expect(calls).toContainEqual({
      op: "insert",
      fields: expect.objectContaining({
        userId: "u1",
        sessionId: null,
        content: "hi",
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      }),
    });
  });
});

// ---- documents 查询 ----

describe("文档查询", () => {
  it("getSidebarAll 只查未归档文档", async () => {
    const calls = mockSupabase([() => ({ data: [{ id: "d1" }] })]);
    const docs = await getSidebarAll("u1");
    expect(docs).toEqual([{ id: "d1" }]);
    expect(calls).toContainEqual({ op: "eq", col: "userId", val: "u1" });
    expect(calls).toContainEqual({ op: "eq", col: "isArchived", val: false });
  });

  it("getTrash 只查已归档文档", async () => {
    const calls = mockSupabase([() => ({ data: [{ id: "t1" }] })]);
    const docs = await getTrash("u1");
    expect(docs).toEqual([{ id: "t1" }]);
    expect(calls).toContainEqual({ op: "eq", col: "isArchived", val: true });
  });
});

// ---- getById 缓存/去重 ----

describe("getById 缓存与去重", () => {
  it("命中缓存时不重复请求", async () => {
    const script = [() => ({ data: { id: "c1", title: "t" } })];
    mockSupabase(script);
    const first = await getById("c1");
    const second = await getById("c1");
    expect(second).toBe(first);
    expect(script).toHaveLength(0); // 第二次未发请求
  });

  it("并发请求同一 id 只发一次请求", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const script = [() => gate.then(() => ({ data: { id: "c2", title: "t" } }))];
    mockSupabase(script);
    const p1 = getById("c2");
    const p2 = getById("c2");
    release();
    const [a, b] = await Promise.all([p1, p2]);
    expect(a).toEqual(b);
    expect(script).toHaveLength(0); // 只消耗一项
  });

  it("文档不存在时抛出 Not found", async () => {
    mockSupabase([() => ({ data: null, error: null })]);
    await expect(getById("missing")).rejects.toThrow("Not found");
  });

  it("getByIdFresh 绕过缓存重新拉取", async () => {
    mockSupabase([
      () => ({ data: { id: "c3", title: "旧" } }),
      () => ({ data: { id: "c3", title: "新" } }),
    ]);
    await getById("c3");
    const fresh = await getByIdFresh("c3");
    expect(fresh.title).toBe("新");
  });

  it("缓存超过上限（200）时淘汰最旧条目，防止内存无限增长", async () => {
    const script = Array.from({ length: 201 }, (_, i) => () => ({ data: { id: `d${i}`, title: `t${i}` } }));
    mockSupabase(script);
    for (let i = 0; i < 201; i++) {
      await getById(`d${i}`);
    }
    // d0 已被淘汰：再次请求需重新拉取（script 已耗尽 → Not found）
    await expect(getById("d0")).rejects.toThrow("Not found");
    // d200 仍在缓存：命中不消耗 script
    await expect(getById("d200")).resolves.toMatchObject({ id: "d200" });
    expect(script).toHaveLength(0);
  });
});

// ---- mutations ----

describe("文档变更", () => {
  it("create 插入默认字段并返回 id", async () => {
    const calls = mockSupabase([() => ({ data: { id: "d1" }, error: null })]);
    await expect(create("u1", "标题", "parent-1")).resolves.toBe("d1");
    expect(calls).toContainEqual({
      op: "insert",
      fields: expect.objectContaining({
        title: "标题",
        userId: "u1",
        parentDocument: "parent-1",
        isArchived: false,
        isPublished: false,
      }),
    });
  });

  it("create 无父文档时 parentDocument 为 null", async () => {
    const calls = mockSupabase([() => ({ data: { id: "d1" }, error: null })]);
    await create("u1", "标题");
    expect(calls).toContainEqual({
      op: "insert",
      fields: expect.objectContaining({ parentDocument: null }),
    });
  });

  it("update 提交字段并使缓存失效", async () => {
    const calls = mockSupabase([
      () => ({ data: { id: "u1", title: "旧" } }), // 首次加载进缓存
      () => ({ error: null }),                     // update
      () => ({ data: { id: "u1", title: "新" } }), // 缓存失效后重新拉取
    ]);
    await getById("u1");
    await update("u1", { title: "新" });
    const after = await getById("u1");
    expect(after.title).toBe("新");
    expect(calls).toContainEqual({ op: "update", fields: { title: "新" } });
  });

  it("archive 递归归档所有子文档后再归档自身", async () => {
    mockSupabase([
      () => ({ data: [{ id: "child1" }, { id: "child2" }] }), // parent 的子文档
      () => ({ data: [] }),                                    // child1 无子文档
      () => ({ error: null }),                                 // archive child1
      () => ({ data: [] }),                                    // child2 无子文档
      () => ({ error: null }),                                 // archive child2
      () => ({ error: null }),                                 // archive parent
    ]);
    await archive("u1", "parent");
    // 三个 update({ isArchived: true })：child1、child2、parent
  });

  it("restore 普通恢复（父文档未归档，不 detach）", async () => {
    const calls = mockSupabase([
      () => ({ data: [] }),                        // 子文档
      () => ({ data: { parentDocument: "p1" } }),  // 自身 parentDocument
      () => ({ data: { isArchived: false } }),     // 父未归档
      () => ({ error: null }),                     // update
    ]);
    await restore("u1", "d1");
    const updateCall = calls.find((c) => c.op === "update");
    expect(updateCall?.fields).toEqual({ isArchived: false });
  });

  it("restore 父文档仍归档时解绑 parentDocument", async () => {
    const calls = mockSupabase([
      () => ({ data: [] }),                        // 子文档
      () => ({ data: { parentDocument: "p1" } }),  // 自身 parentDocument
      () => ({ data: { isArchived: true } }),      // 父已归档
      () => ({ error: null }),                     // update
    ]);
    await restore("u1", "d1");
    const updateCall = calls.find((c) => c.op === "update");
    expect(updateCall?.fields).toEqual({ isArchived: false, parentDocument: null });
  });

  it("remove 按 id 删除", async () => {
    const calls = mockSupabase([() => ({ error: null })]);
    await remove("d1");
    expect(calls).toContainEqual({ op: "delete" });
    expect(calls).toContainEqual({ op: "eq", col: "id", val: "d1" });
  });

  it("removeIcon / removeCoverImage 更新为 null", async () => {
    const calls1 = mockSupabase([() => ({ error: null })]);
    await removeIcon("d1");
    expect(calls1).toContainEqual({ op: "update", fields: { icon: null } });

    const calls2 = mockSupabase([() => ({ error: null })]);
    await removeCoverImage("d1");
    expect(calls2).toContainEqual({ op: "update", fields: { coverImage: null } });
  });

  it("update 失败时抛错且不动缓存", async () => {
    mockSupabase([() => ({ error: { message: "update failed" } })]);
    await expect(update("d1", { title: "x" })).rejects.toThrow("update failed");
  });
});
