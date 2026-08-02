import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runNoteAgent } from "@/lib/agent";

// ---- hoisted 共享状态（vi.mock factory 不能引用外部变量） ----

const { mockConfig } = vi.hoisted(() => ({
  mockConfig: {
    tool: "none" as "createNote" | "readNote" | "updateNote" | "deleteNote" | "none",
    emitStepFinish: false,
    emitError: false,
    capturedMessages: [] as Array<{ role: string; content: string }>,
    capturedSystem: "" as string,
    abortSignal: null as AbortSignal | null,
  },
}));

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    streamText: (options: {
      system?: string;
      messages?: Array<{ role: string; content: string }>;
      tools?: Record<string, { execute?: (args: unknown, opts?: unknown) => Promise<unknown> }>;
      abortSignal?: AbortSignal;
      onStepFinish?: (info: { finishReason: string; toolCalls?: Array<{ toolName: string; args: unknown }>; text: string }) => void;
      onError?: (info: { error: Error }) => void;
      onFinish?: (info: { finishReason: string; usage: unknown; text: string; steps: unknown[] }) => void;
    }) => {
      // 捕获注入 streamText 的消息（断言历史注入/中止行为用）
      mockConfig.capturedMessages = options.messages ?? [];
      mockConfig.capturedSystem = options.system ?? "";
      // 捕获 abortSignal：断言 deleteNote 中止行为
      mockConfig.abortSignal = options.abortSignal ?? null;
      return {
        textStream: new ReadableStream<string>({
          async start(controller) {
            // 模拟模型调用工具（真实 createTools，副作用经 onEvent 上报）
            const toolName = mockConfig.tool;
            if (toolName !== "none" && options.tools?.[toolName]) {
              const args =
                toolName === "createNote"
                  ? { title: "测试笔记", content: "笔记内容" }
                  : toolName === "updateNote"
                    ? { noteId: "doc-123", content: "新内容" }
                    : { noteId: "doc-123" };
              await options.tools[toolName]!.execute!(args, { toolCallId: "t1" });
            }
            // 模拟工具调用完成回调 → 触发 progress 事件注入 / deleteNote 中止检测
            if (mockConfig.emitStepFinish || toolName === "deleteNote") {
              options.onStepFinish?.({
                finishReason: "tool-calls",
                toolCalls: [{ toolName: toolName === "deleteNote" ? "deleteNote" : "searchNotes", args: {} }],
                text: "",
              });
            }
            if (mockConfig.emitError) {
              options.onError?.({ error: new Error("mock boom") });
            }
            controller.enqueue("正在处理...");
            // 模拟流结束 → agent 的 done promise 依赖 onFinish resolve
            options.onFinish?.({
              finishReason: "stop",
              usage: { inputTokens: 1, outputTokens: 2 },
              text: "mock text",
              steps: [],
            });
            controller.close();
          },
        }),
      };
    },
  };
});

vi.mock("@/lib/logger", () => {
  const noop = () => {};
  const ns = new Proxy({}, { get: () => noop });
  return { logger: { api: ns, agent: ns, tools: ns, db: ns, compress: ns } };
});

// ---- fake supabase：只支持 documents 表 ----

const fakeSupabase = {
  from: (table: string) => {
    if (table !== "documents") throw new Error(`unexpected table: ${table}`);
    return {
      insert: () => ({
        select: () => ({
          single: async () => ({ data: { id: "doc-123" }, error: null }),
        }),
      }),
      select: () => ({
        eq: () => ({
          eq: () => ({
            single: async () => ({
              data: { id: "doc-123", title: "引用笔记", content: "笔记内容" },
              error: null,
            }),
          }),
        }),
      }),
      update: () => ({
        eq: () => ({
          eq: () => ({
            select: () => ({
              single: async () => ({
                data: { id: "doc-123", title: "引用笔记", content: "笔记内容" },
                error: null,
              }),
            }),
          }),
        }),
      }),
    };
  },
} as unknown as SupabaseClient;

// ---- helpers ----

interface SseEvent {
  type: string;
  [key: string]: unknown;
}

/** 解析 SSE 流（data: <json> 以空行分隔）为事件数组 */
async function readEvents(stream: ReadableStream<Uint8Array>): Promise<SseEvent[]> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const events: SseEvent[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const raw = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      if (raw.startsWith("data: ")) {
        events.push(JSON.parse(raw.slice(6)));
      }
    }
  }
  return events;
}

beforeEach(() => {
  mockConfig.tool = "none";
  mockConfig.emitStepFinish = false;
  mockConfig.emitError = false;
  mockConfig.capturedMessages = [];
  mockConfig.abortSignal = null;
});

// ---- tests ----

describe("runNoteAgent SSE 事件注入", () => {
  it("createNote 执行后推送 note_created 事件（独立事件行，不混入文本）", async () => {
    mockConfig.tool = "createNote";
    const { stream } = await runNoteAgent(fakeSupabase, "user-1", "帮我创建一篇笔记");
    const events = await readEvents(stream);

    const created = events.find((e) => e.type === "note_created");
    expect(created?.noteId).toBe("doc-123");
    // 文本走 text 事件通道，事件行不被拼进文本内容
    const textEvents = events.filter((e) => e.type === "text").map((e) => e.text);
    expect(textEvents).toEqual(["正在处理..."]);
  });

  it("updateNote 执行后流结束前推送 references 事件（标题不编码）", async () => {
    mockConfig.tool = "updateNote";
    const { stream, done } = await runNoteAgent(fakeSupabase, "user-1", "改一下笔记");
    const events = await readEvents(stream);

    const refs = events.find((e) => e.type === "references");
    expect(refs?.references).toEqual([{ noteId: "doc-123", title: "引用笔记" }]);
    // done 携带引用信息供 route 落库
    const result = await done;
    expect(result.references).toEqual([{ noteId: "doc-123", title: "引用笔记" }]);
  });

  it("readNote 执行后不推送 references 事件（纯读取不展示胶囊）", async () => {
    mockConfig.tool = "readNote";
    const { stream, done } = await runNoteAgent(fakeSupabase, "user-1", "读一下笔记");
    const events = await readEvents(stream);

    expect(events.some((e) => e.type === "references")).toBe(false);
    const result = await done;
    expect(result.references).toEqual([]);
  });

  it("onStepFinish 工具调用触发 progress 事件（带工具中文标签）", async () => {
    mockConfig.emitStepFinish = true;
    const { stream } = await runNoteAgent(fakeSupabase, "user-1", "搜索一下");
    const events = await readEvents(stream);

    const prog = events.find((e) => e.type === "progress");
    expect(prog?.label).toContain("🔍 搜索笔记");
  });

  it("无工具调用时只有 text 事件，无副作用事件", async () => {
    const { stream } = await runNoteAgent(fakeSupabase, "user-1", "你好");
    const events = await readEvents(stream);

    expect(events).toEqual([{ type: "text", text: "正在处理..." }]);
  });

  it("done promise 在流结束后 resolve 出文本与 usage", async () => {
    const { done } = await runNoteAgent(fakeSupabase, "user-1", "你好");
    const result = await done;
    expect(typeof result.text).toBe("string");
    expect(result.usage).toMatchObject({
      inputTokens: expect.any(Number),
      outputTokens: expect.any(Number),
    });
  });
});

describe("runNoteAgent deleteNote 中止语义", () => {
  it("deleteNote 触发确认后中止本轮生成（避免确认前继续执行其他工具）", async () => {
    mockConfig.tool = "deleteNote";
    const { stream } = await runNoteAgent(fakeSupabase, "user-1", "删除这篇笔记");
    const events = await readEvents(stream);

    // confirm_delete 事件已推送，且内部 AbortController 已触发（生成被中止）
    expect(events.some((e) => e.type === "confirm_delete")).toBe(true);
    expect(mockConfig.abortSignal?.aborted).toBe(true);
  });

  it("非 deleteNote 的工具调用不会中止生成", async () => {
    mockConfig.tool = "createNote";
    const { stream } = await runNoteAgent(fakeSupabase, "user-1", "创建笔记");
    await readEvents(stream);

    expect(mockConfig.abortSignal?.aborted).toBe(false);
  });
});

describe("runNoteAgent error 事件", () => {
  it("生成中途出错推送 error 事件（前端明确提示，而非静默断流）", async () => {
    mockConfig.emitError = true;
    const { stream } = await runNoteAgent(fakeSupabase, "user-1", "你好");
    const events = await readEvents(stream);

    expect(events.some((e) => e.type === "error" && e.message === "mock boom")).toBe(true);
  });
});

describe("runNoteAgent 历史注入（全量，无预算限制）", () => {
  it("全部历史消息注入，不做条数限制", async () => {
    const history = Array.from({ length: 30 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `消息 ${i}`,
    }));
    const { stream } = await runNoteAgent(fakeSupabase, "user-1", "继续", { history });
    await readEvents(stream);

    // capturedMessages = 历史 + 当前 prompt（最后一条）
    const historyMsgs = mockConfig.capturedMessages.slice(0, -1);
    expect(historyMsgs).toHaveLength(30);
    // 最早的消息也完整保留（不被预算丢弃）
    expect(historyMsgs[0].content).toBe("消息 0");
    expect(historyMsgs[historyMsgs.length - 1].content).toBe("消息 29");
  });

  it("单条历史消息不截断（原样注入）", async () => {
    const longContent = "字".repeat(5_000);
    const history = [{ role: "user" as const, content: longContent }];
    const { stream } = await runNoteAgent(fakeSupabase, "user-1", "继续", { history });
    await readEvents(stream);

    const historyMsg = mockConfig.capturedMessages[0];
    expect(historyMsg.content).toBe(longContent);
  });

  it("无历史时只注入当前 prompt", async () => {
    const { stream } = await runNoteAgent(fakeSupabase, "user-1", "你好");
    await readEvents(stream);

    expect(mockConfig.capturedMessages).toEqual([{ role: "user", content: "你好" }]);
  });
});

describe("runNoteAgent 会话摘要注入", () => {
  it("summary 存在时注入 system 摘要段", async () => {
    const { stream } = await runNoteAgent(fakeSupabase, "user-1", "继续", {
      summary: "早期对话摘要：用户创建了笔记《路线图》",
    });
    await readEvents(stream);

    expect(mockConfig.capturedSystem).toContain("早期对话摘要：用户创建了笔记《路线图》");
    expect(mockConfig.capturedSystem).toContain("以下是本会话早期对话的摘要");
  });

  it("无 summary 时 system 不含摘要段", async () => {
    const { stream } = await runNoteAgent(fakeSupabase, "user-1", "你好");
    await readEvents(stream);

    expect(mockConfig.capturedSystem).not.toContain("以下是本会话早期对话的摘要");
  });
});
