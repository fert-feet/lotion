import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  buildCompressPrompt,
  parseCompressResult,
  applyCompressConstraints,
  maybeCompressSession,
  type CompressMessage,
} from "@/lib/compress";
import {
  getChatHistory,
  getChatSessionSummary,
  updateChatSessionSummary,
  markMessagesCompressed,
} from "@/lib/db";

// ---- mocks ----

const { mockGenerateText } = vi.hoisted(() => ({ mockGenerateText: vi.fn() }));

vi.mock("ai", () => ({
  generateText: (...args: unknown[]) => mockGenerateText(...args),
}));

vi.mock("@/lib/db", () => ({
  getChatHistory: vi.fn(),
  getChatSessionSummary: vi.fn(),
  updateChatSessionSummary: vi.fn(),
  markMessagesCompressed: vi.fn(),
}));

vi.mock("@/lib/logger", () => {
  const noop = () => {};
  const ns = new Proxy({}, { get: () => noop });
  return { logger: { api: ns, agent: ns, tools: ns, db: ns, compress: ns } };
});

const fakeSupabase = {} as never;

function makeMsg(id: string, content: string, role: "user" | "assistant" = "user"): CompressMessage {
  return { id, role, content };
}

/** 构造 messages：count 条，每条 charPerMsg 字符，id 为 m0..mN */
function makeMessages(count: number, charPerMsg = 100): CompressMessage[] {
  return Array.from({ length: count }, (_, i) =>
    makeMsg(`m${i}`, `内容${i}`.padEnd(charPerMsg, "字"))
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGenerateText.mockResolvedValue({ text: '{"keep":[],"summary":"会话摘要"}' });
  (getChatHistory as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (getChatSessionSummary as ReturnType<typeof vi.fn>).mockResolvedValue(null);
  (updateChatSessionSummary as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  (markMessagesCompressed as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
});

// ---- 纯函数：prompt 构造 ----

describe("buildCompressPrompt", () => {
  it("包含消息正文、旧摘要与约束参数", () => {
    const prompt = buildCompressPrompt(
      [makeMsg("m1", "第一条"), makeMsg("m2", "第二条", "assistant")],
      "旧摘要内容",
    );
    expect(prompt).toContain("[user] 第一条");
    expect(prompt).toContain("[assistant] 第二条");
    expect(prompt).toContain("旧摘要内容");
    expect(prompt).toContain("最多 40 条");
    expect(prompt).toContain("最近 5 条");
    expect(prompt).toContain("800 字符");
  });

  it("无旧摘要时省略摘要段", () => {
    const prompt = buildCompressPrompt([makeMsg("m1", "第一条")], null);
    expect(prompt).not.toContain("已有早期摘要");
  });
});

// ---- 纯函数：JSON 解析 ----

describe("parseCompressResult", () => {
  it("解析纯 JSON", () => {
    expect(parseCompressResult('{"keep":["m1"],"summary":"摘要"}')).toEqual({
      keep: ["m1"],
      summary: "摘要",
    });
  });

  it("容忍代码围栏与前后杂文本", () => {
    const text = '好的，结果如下：\n```json\n{"keep":["m1","m2"],"summary":"摘要"}\n```\n希望有帮助';
    expect(parseCompressResult(text)).toEqual({ keep: ["m1", "m2"], summary: "摘要" });
  });

  it("过滤 keep 中的非字符串元素", () => {
    expect(parseCompressResult('{"keep":["m1",42,null],"summary":"摘要"}')).toEqual({
      keep: ["m1"],
      summary: "摘要",
    });
  });

  it("非法 JSON 返回 null", () => {
    expect(parseCompressResult("这不是 JSON")).toBeNull();
    expect(parseCompressResult('{"keep":[]')).toBeNull();
  });

  it("结构不符返回 null", () => {
    expect(parseCompressResult('{"keep":"m1","summary":"摘要"}')).toBeNull();
    expect(parseCompressResult('{"keep":[],"summary":123}')).toBeNull();
  });
});

// ---- 纯函数：硬约束 ----

describe("applyCompressConstraints", () => {
  const messages = makeMessages(10); // m0..m9

  it("最近 KEEP_FLOOR 条必留（模型 keep 为空时仍保留地板）", () => {
    const result = applyCompressConstraints({ keep: [], summary: "摘要" }, messages);
    expect(result).not.toBeNull();
    expect(result!.keepSet).toEqual(new Set(["m5", "m6", "m7", "m8", "m9"]));
    expect(result!.summary).toBe("摘要");
  });

  it("模型 keep 只接受候选池内的 id", () => {
    const result = applyCompressConstraints(
      { keep: ["m1", "不存在", "m9"], summary: "摘要" },
      messages,
    );
    expect(result!.keepSet).toContain("m1");
    expect(result!.keepSet).toContain("m9"); // 地板内
    expect(result!.keepSet).not.toContain("不存在");
  });

  it("keep 超上限时截断（含地板不超过 40）", () => {
    const many = makeMessages(50);
    const result = applyCompressConstraints(
      { keep: many.map((m) => m.id), summary: "摘要" },
      many,
    );
    expect(result!.keepSet.size).toBeLessThanOrEqual(40);
  });

  it("摘要超长时截断到 800 字符", () => {
    const result = applyCompressConstraints({ keep: [], summary: "长".repeat(2_000) }, messages);
    expect(result!.summary.length).toBe(800);
  });

  it("全部保留时返回 null 降级", () => {
    const result = applyCompressConstraints(
      { keep: messages.map((m) => m.id), summary: "摘要" },
      messages,
    );
    expect(result).toBeNull();
  });

  it("摘要为空时返回 null 降级", () => {
    const result = applyCompressConstraints({ keep: [], summary: "   " }, messages);
    expect(result).toBeNull();
  });
});

// ---- 集成：maybeCompressSession ----

describe("maybeCompressSession", () => {
  it("未达阈值不调用模型", async () => {
    (getChatHistory as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeMessages(10, 100).map((m) => ({ id: m.id, role: m.role, content: m.content, createdAt: "" })),
    );
    await maybeCompressSession(fakeSupabase, "user-1", "s1");
    expect(mockGenerateText).not.toHaveBeenCalled();
    expect(updateChatSessionSummary).not.toHaveBeenCalled();
  });

  it("超阈值：写摘要并标记非保留消息为 compressed", async () => {
    // 30 条 × 1200 字符 = 36000 > 30000 阈值
    const msgs = makeMessages(30, 1_200).map((m) => ({
      id: m.id, role: m.role, content: m.content, createdAt: "",
    }));
    (getChatHistory as ReturnType<typeof vi.fn>).mockResolvedValue(msgs);
    mockGenerateText.mockResolvedValue({ text: '{"keep":["m0"],"summary":"压缩后的摘要"}' });

    await maybeCompressSession(fakeSupabase, "user-1", "s1");

    expect(mockGenerateText).toHaveBeenCalledTimes(1);
    // 摘要写入：重写式
    expect(updateChatSessionSummary).toHaveBeenCalledWith(
      fakeSupabase, "user-1", "s1", "压缩后的摘要",
    );
    // 标记：模型 keep(m0) + 地板(最近 5 条)保留，其余标记
    const marked = (markMessagesCompressed as ReturnType<typeof vi.fn>).mock.calls[0][2] as string[];
    expect(marked).not.toContain("m0");
    expect(marked).not.toContain("m25"); // 地板内
    expect(marked).toContain("m1");
    expect(marked).toContain("m24");
    expect(marked.length).toBe(30 - 1 - 5);
  });

  it("模型输出解析失败时降级不写库", async () => {
    (getChatHistory as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeMessages(30, 1_200).map((m) => ({ id: m.id, role: m.role, content: m.content, createdAt: "" })),
    );
    mockGenerateText.mockResolvedValue({ text: "抱歉，我无法理解" });
    await maybeCompressSession(fakeSupabase, "user-1", "s1");
    expect(updateChatSessionSummary).not.toHaveBeenCalled();
    expect(markMessagesCompressed).not.toHaveBeenCalled();
  });

  it("模型异常时降级不抛错", async () => {
    (getChatHistory as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeMessages(30, 1_200).map((m) => ({ id: m.id, role: m.role, content: m.content, createdAt: "" })),
    );
    mockGenerateText.mockRejectedValue(new Error("api down"));
    await expect(maybeCompressSession(fakeSupabase, "user-1", "s1")).resolves.toBeUndefined();
    expect(updateChatSessionSummary).not.toHaveBeenCalled();
  });

  it("超输入预算时只保留最近消息参与压缩（最旧部分不参与也不标记）", async () => {
    // 7 条 × 10000 = 70000 > 60000 输入预算 → 输入 = 最近 6 条（m1..m6），m0 被截掉
    const msgs = makeMessages(7, 10_000).map((m) => ({
      id: m.id, role: m.role, content: m.content, createdAt: "",
    }));
    (getChatHistory as ReturnType<typeof vi.fn>).mockResolvedValue(msgs);
    mockGenerateText.mockResolvedValue({ text: '{"keep":[],"summary":"摘要"}' });

    await maybeCompressSession(fakeSupabase, "user-1", "s1");

    // 输入 = m1..m6：地板(m2..m6)保留，m1 被标记；被截掉的 m0 不参与也不标记
    const marked = (markMessagesCompressed as ReturnType<typeof vi.fn>).mock.calls[0][2] as string[];
    expect(marked).toEqual(["m1"]);
    expect(updateChatSessionSummary).toHaveBeenCalledWith(fakeSupabase, "user-1", "s1", "摘要");
  });

  it("同一会话并发调用串行执行（后到的等待先到的完成）", async () => {
    (getChatHistory as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeMessages(30, 1_200).map((m) => ({ id: m.id, role: m.role, content: m.content, createdAt: "" })),
    );
    let resolveFirst!: (v: { text: string }) => void;
    mockGenerateText.mockImplementationOnce(
      () => new Promise((res) => { resolveFirst = res; }),
    );
    mockGenerateText.mockResolvedValue({ text: '{"keep":[],"summary":"第二轮摘要"}' });

    const p1 = maybeCompressSession(fakeSupabase, "user-1", "s1");
    const p2 = maybeCompressSession(fakeSupabase, "user-1", "s1");

    // 第二次调用尚未进入模型（被锁链阻塞）
    await vi.waitFor(() => expect(mockGenerateText).toHaveBeenCalledTimes(1));
    resolveFirst({ text: '{"keep":[],"summary":"第一轮摘要"}' });
    await Promise.all([p1, p2]);

    // 两次压缩依次完成
    expect(mockGenerateText).toHaveBeenCalledTimes(2);
    const summaries = (updateChatSessionSummary as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[3]);
    expect(summaries).toEqual(["第一轮摘要", "第二轮摘要"]);
  });

  it("不同会话互不阻塞", async () => {
    (getChatHistory as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeMessages(30, 1_200).map((m) => ({ id: m.id, role: m.role, content: m.content, createdAt: "" })),
    );
    let resolveFirst!: (v: { text: string }) => void;
    mockGenerateText.mockImplementationOnce(
      () => new Promise((res) => { resolveFirst = res; }),
    );
    mockGenerateText.mockResolvedValue({ text: '{"keep":[],"summary":"s2 摘要"}' });

    const p1 = maybeCompressSession(fakeSupabase, "user-1", "s1");
    const p2 = maybeCompressSession(fakeSupabase, "user-1", "s2");
    await vi.waitFor(() => expect(mockGenerateText).toHaveBeenCalledTimes(2)); // 不同会话直接并行

    resolveFirst({ text: '{"keep":[],"summary":"s1 摘要"}' });
    await Promise.all([p1, p2]);
  });
});
