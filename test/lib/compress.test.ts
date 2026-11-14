import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  buildSummaryPrompt,
  estimateTokens,
  extractSummary,
  maybeCompressSession,
  splitWindow,
  WINDOW_MIN_MESSAGES,
  WINDOW_SIZE,
  type CompressMessage,
} from "@/lib/compress";
import {
  listChatHistory,
  getChatSessionSummary,
  setChatSessionSummary,
  markMessagesCompressed,
} from "@/lib/local/db";

// ---- mocks ----

const { mockGenerateText } = vi.hoisted(() => ({ mockGenerateText: vi.fn() }));

vi.mock("ai", () => ({
  generateText: (...args: unknown[]) => mockGenerateText(...args),
}));

vi.mock("@/lib/local/sqlite", () => ({
  getDb: () => ({} as never), // db 相关函数全部被 mock，getDb 只需可调用
}));

vi.mock("@/lib/local/db", () => ({
  listChatHistory: vi.fn(),
  getChatSessionSummary: vi.fn(),
  setChatSessionSummary: vi.fn(),
  markMessagesCompressed: vi.fn(),
}));

vi.mock("@/lib/logger", () => {
  const noop = () => {};
  const ns = new Proxy({}, { get: () => noop });
  return { logger: { api: ns, agent: ns, tools: ns, db: ns, compress: ns } };
});


function makeMsg(id: string, content: string, role: "user" | "assistant" = "user"): CompressMessage {
  return { id, role, content };
}

/** 构造 messages：count 条，id 为 m0..mN（最旧在前） */
function makeMessages(count: number, content = "内容"): CompressMessage[] {
  return Array.from({ length: count }, (_, i) => makeMsg(`m${i}`, content));
}

/** 转成 db 返回形态 */
function asDbMessages(msgs: CompressMessage[]) {
  return msgs.map((m) => ({ id: m.id, role: m.role, content: m.content, createdAt: "" }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGenerateText.mockResolvedValue({ text: "会话摘要" });
  (listChatHistory as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (getChatSessionSummary as ReturnType<typeof vi.fn>).mockResolvedValue(null);
  (setChatSessionSummary as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  (markMessagesCompressed as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
});

// ---- 纯函数：prompt 构造 ----

describe("buildSummaryPrompt", () => {
  it("包含窗口外消息正文、旧摘要与长度约束", () => {
    const prompt = buildSummaryPrompt(
      [makeMsg("m1", "第一条"), makeMsg("m2", "第二条", "assistant")],
      "旧摘要内容",
    );
    expect(prompt).toContain("[user] 第一条");
    expect(prompt).toContain("[assistant] 第二条");
    expect(prompt).toContain("旧摘要内容");
    expect(prompt).toContain("合并重写");
    expect(prompt).toContain("800 字符");
  });

  it("无旧摘要时省略摘要段", () => {
    const prompt = buildSummaryPrompt([makeMsg("m1", "第一条")], null);
    expect(prompt).not.toContain("已有早期摘要");
  });
});

// ---- 纯函数：摘要提取 ----

describe("extractSummary", () => {
  it("直接输出原文", () => {
    expect(extractSummary("会话摘要")).toBe("会话摘要");
  });

  it("容忍代码围栏与前后杂文本", () => {
    expect(extractSummary('好的：\n```text\n摘要内容\n```\n希望有帮助')).toBe("摘要内容");
  });

  it("超长时截断到 800 字符", () => {
    const out = extractSummary("长".repeat(2_000));
    expect(out!.length).toBe(800);
  });

  it("空输出返回 null", () => {
    expect(extractSummary("   ")).toBeNull();
    expect(extractSummary("```text\n```")).toBeNull();
  });
});

// ---- 纯函数：token 预算窗口 ----

describe("estimateTokens", () => {
  it("CJK 按字计，ASCII 按 4 字符计", () => {
    expect(estimateTokens("你好世界")).toBe(4);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("你好abcd")).toBe(3); // 2 + ceil(4/4)
  });

  it("全角标点按 CJK 计（否则长中文标点会低估）", () => {
    expect(estimateTokens("，。！")).toBe(3);
  });
});

describe("splitWindow", () => {
  it("token 未超预算且条数未超上限 → 不压缩", () => {
    const msgs = makeMessages(5, "短消息");
    const { overflow, kept, keptTokens } = splitWindow(msgs);
    expect(overflow).toHaveLength(0);
    expect(kept).toHaveLength(5);
    expect(keptTokens).toBeGreaterThan(0);
  });

  it("token 预算先命中：长消息只保留到预算内，其余进 overflow", () => {
    // 每条 4000 个汉字 ≈ 4000 token，预算 10000 → 只保留最近 2 条
    const msgs = makeMessages(6, "字".repeat(4000));
    const { overflow, kept } = splitWindow(msgs, { budget: 10_000, maxMessages: 100, minKeep: 1 });
    expect(kept).toHaveLength(2);
    expect(overflow).toHaveLength(4);
    expect(overflow[0]!.id).toBe("m0");
    expect(kept[kept.length - 1]!.id).toBe("m5");
  });

  it("条数上限仍然生效（短消息场景与旧行为一致）", () => {
    const msgs = makeMessages(WINDOW_SIZE + 20, "短");
    const { overflow, kept } = splitWindow(msgs);
    expect(kept).toHaveLength(WINDOW_SIZE);
    expect(overflow).toHaveLength(20);
  });

  it("至少保留 WINDOW_MIN_MESSAGES 条：单条巨型消息不会把窗口挤空", () => {
    const msgs = makeMessages(WINDOW_MIN_MESSAGES + 2, "字".repeat(200_000));
    const { kept } = splitWindow(msgs);
    expect(kept.length).toBeGreaterThanOrEqual(WINDOW_MIN_MESSAGES);
  });
});

// ---- 集成：maybeCompressSession ----

describe("maybeCompressSession", () => {
  it("未超过滑动窗口（含恰好等于窗口）不调用模型", async () => {
    (listChatHistory as ReturnType<typeof vi.fn>).mockResolvedValue(
      asDbMessages(makeMessages(WINDOW_SIZE)),
    );
    await maybeCompressSession("user-1", "s1");
    expect(mockGenerateText).not.toHaveBeenCalled();
    expect(setChatSessionSummary).not.toHaveBeenCalled();
  });

  it("超过窗口：只压最旧溢出部分，最近 WINDOW_SIZE 条不标记", async () => {
    // 120 条：溢出 = 最旧 20 条（m0..m19），窗口内 m20..m119 保留原文
    const msgs = makeMessages(WINDOW_SIZE + 20);
    (listChatHistory as ReturnType<typeof vi.fn>).mockResolvedValue(asDbMessages(msgs));

    await maybeCompressSession("user-1", "s1");

    expect(mockGenerateText).toHaveBeenCalledTimes(1);
    expect(setChatSessionSummary).toHaveBeenCalledWith(expect.anything(), "user-1", "s1", "会话摘要");
    const marked = (markMessagesCompressed as ReturnType<typeof vi.fn>).mock.calls[0][2] as string[];
    expect(marked).toHaveLength(20);
    expect(marked[0]).toBe("m0");
    expect(marked[19]).toBe("m19");
    expect(marked).not.toContain("m20"); // 窗口边界第一条
    expect(marked).not.toContain("m119");
  });

  it("重写式：旧摘要传入 prompt（合并而非替换）", async () => {
    (getChatSessionSummary as ReturnType<typeof vi.fn>).mockResolvedValue("早期摘要");
    (listChatHistory as ReturnType<typeof vi.fn>).mockResolvedValue(
      asDbMessages(makeMessages(WINDOW_SIZE + 10)),
    );

    await maybeCompressSession("user-1", "s1");

    const prompt = (mockGenerateText as ReturnType<typeof vi.fn>).mock.calls[0][0].prompt as string;
    expect(prompt).toContain("早期摘要");
  });

  it("摘要输出无效时降级不写库", async () => {
    (listChatHistory as ReturnType<typeof vi.fn>).mockResolvedValue(
      asDbMessages(makeMessages(WINDOW_SIZE + 10)),
    );
    mockGenerateText.mockResolvedValue({ text: "   " });
    await maybeCompressSession("user-1", "s1");
    expect(setChatSessionSummary).not.toHaveBeenCalled();
    expect(markMessagesCompressed).not.toHaveBeenCalled();
  });

  it("模型异常时降级不抛错", async () => {
    (listChatHistory as ReturnType<typeof vi.fn>).mockResolvedValue(
      asDbMessages(makeMessages(WINDOW_SIZE + 10)),
    );
    mockGenerateText.mockRejectedValue(new Error("api down"));
    await expect(maybeCompressSession("user-1", "s1")).resolves.toBeUndefined();
    expect(setChatSessionSummary).not.toHaveBeenCalled();
  });

  it("溢出消息超过批次上限时只压最近一部分（最旧部分不参与也不标记）", async () => {
    // 800 条：溢出 700 条（m0..m699），批次上限 500 → 输入 = 最近 500 条（m200..m699）
    const msgs = makeMessages(WINDOW_SIZE + 700);
    (listChatHistory as ReturnType<typeof vi.fn>).mockResolvedValue(asDbMessages(msgs));

    await maybeCompressSession("user-1", "s1");

    const marked = (markMessagesCompressed as ReturnType<typeof vi.fn>).mock.calls[0][2] as string[];
    expect(marked).toHaveLength(500);
    expect(marked[0]).toBe("m200");
    expect(marked[499]).toBe("m699");
    expect(marked).not.toContain("m0"); // 被截掉的最旧部分不标记，下次重试
    expect(marked).not.toContain("m199");
  });

  it("长消息触发 token 预算：不需要等到 100 条就会压缩", async () => {
    // 30 条 × 4000 token ≈ 120k token，远超预算；窗口内只保留预算允许的最近几条
    const msgs = makeMessages(30, "字".repeat(4000));
    (listChatHistory as ReturnType<typeof vi.fn>).mockResolvedValue(asDbMessages(msgs));

    await maybeCompressSession("user-1", "s1");

    expect(mockGenerateText).toHaveBeenCalledTimes(1);
    const marked = (markMessagesCompressed as ReturnType<typeof vi.fn>).mock.calls[0][2] as string[];
    // 至少压掉一部分，且最近一条永远保留原文
    expect(marked.length).toBeGreaterThan(0);
    expect(marked.length).toBeLessThan(30);
    expect(marked).not.toContain("m29");
  });

  it("同一会话并发调用串行执行（后到的等待先到的完成）", async () => {
    (listChatHistory as ReturnType<typeof vi.fn>).mockResolvedValue(
      asDbMessages(makeMessages(WINDOW_SIZE + 10)),
    );
    let resolveFirst!: (v: { text: string }) => void;
    mockGenerateText.mockImplementationOnce(
      () => new Promise((res) => { resolveFirst = res; }),
    );
    mockGenerateText.mockResolvedValue({ text: "第二轮摘要" });

    const p1 = maybeCompressSession("user-1", "s1");
    const p2 = maybeCompressSession("user-1", "s1");

    // 第二次调用尚未进入模型（被锁链阻塞）
    await vi.waitFor(() => expect(mockGenerateText).toHaveBeenCalledTimes(1));
    resolveFirst({ text: "第一轮摘要" });
    await Promise.all([p1, p2]);

    // 两次压缩依次完成
    expect(mockGenerateText).toHaveBeenCalledTimes(2);
    const summaries = (setChatSessionSummary as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[3]);
    expect(summaries).toEqual(["第一轮摘要", "第二轮摘要"]);
  });

  it("不同会话互不阻塞", async () => {
    (listChatHistory as ReturnType<typeof vi.fn>).mockResolvedValue(
      asDbMessages(makeMessages(WINDOW_SIZE + 10)),
    );
    let resolveFirst!: (v: { text: string }) => void;
    mockGenerateText.mockImplementationOnce(
      () => new Promise((res) => { resolveFirst = res; }),
    );
    mockGenerateText.mockResolvedValue({ text: "s2 摘要" });

    const p1 = maybeCompressSession("user-1", "s1");
    const p2 = maybeCompressSession("user-1", "s2");
    await vi.waitFor(() => expect(mockGenerateText).toHaveBeenCalledTimes(2)); // 不同会话直接并行

    resolveFirst({ text: "s1 摘要" });
    await Promise.all([p1, p2]);
  });
});
