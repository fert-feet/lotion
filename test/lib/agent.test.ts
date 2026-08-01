import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runNoteAgent } from "@/lib/agent";

// ---- hoisted 共享状态（vi.mock factory 不能引用外部变量） ----

const { mockConfig } = vi.hoisted(() => ({
  mockConfig: {
    tool: "createNote" as "createNote" | "readNote" | "updateNote" | "none",
    emitStepFinish: false,
  },
}));

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    streamText: (options: any) => ({
      textStream: new ReadableStream<string>({
        async start(controller) {
          // 模拟模型调用工具（真实 createTools，会写共享变量 pendingNoteId / references）
          const toolName = mockConfig.tool;
          if (toolName !== "none" && options.tools?.[toolName]) {
            const args =
              toolName === "createNote"
                ? { title: "测试笔记", content: "笔记内容" }
                : toolName === "updateNote"
                  ? { noteId: "doc-123", content: "新内容" }
                  : { noteId: "doc-123" };
            await options.tools[toolName].execute(args, { toolCallId: "t1" });
          }
          // 模拟工具调用完成回调 → 触发 progress 事件注入
          if (mockConfig.emitStepFinish) {
            options.onStepFinish?.({
              finishReason: "tool-calls",
              toolCalls: [{ toolName: "searchNotes", args: {} }],
              text: "",
            });
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
    }),
  };
});

vi.mock("@/lib/logger", () => {
  const noop = () => {};
  const ns = new Proxy({}, { get: () => noop });
  return { logger: { api: ns, agent: ns, tools: ns } };
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
