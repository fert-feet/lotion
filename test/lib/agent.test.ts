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
          // 模拟工具调用完成回调 → 触发 [PROGRESS:...] 注入
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
          single: async () => ({
            data: { id: "doc-123", title: "引用笔记", content: "笔记内容" },
            error: null,
          }),
        }),
      }),
      update: () => ({
        eq: () => ({
          select: () => ({
            single: async () => ({
              data: { id: "doc-123", title: "引用笔记", content: "笔记内容" },
              error: null,
            }),
          }),
        }),
      }),
    };
  },
} as unknown as SupabaseClient;

// ---- helpers ----

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return text;
}

beforeEach(() => {
  mockConfig.tool = "none";
  mockConfig.emitStepFinish = false;
});

// ---- tests ----

describe("runNoteAgent 流标记注入", () => {
  it("createNote 执行后向流中注入 [NOTE_CREATED] 标记", async () => {
    mockConfig.tool = "createNote";
    const { stream } = await runNoteAgent(fakeSupabase, "user-1", "帮我创建一篇笔记");
    const text = await readAll(stream);
    expect(text).toContain("[NOTE_CREATED:doc-123]");
    expect(text).toContain("正在处理...");
  });

  it("updateNote 执行后流结束前注入 [REFERENCES] 标记（标题 URL 编码）", async () => {
    mockConfig.tool = "updateNote";
    const { stream, done } = await runNoteAgent(fakeSupabase, "user-1", "改一下笔记");
    const text = await readAll(stream);
    expect(text).toContain(`[REFERENCES:doc-123:${encodeURIComponent("引用笔记")}]`);
    // done 携带引用信息供 route 落库
    const result = await done;
    expect(result.references).toEqual([{ noteId: "doc-123", title: "引用笔记" }]);
  });

  it("readNote 执行后不注入 [REFERENCES] 标记（纯读取不展示胶囊）", async () => {
    mockConfig.tool = "readNote";
    const { stream, done } = await runNoteAgent(fakeSupabase, "user-1", "读一下笔记");
    const text = await readAll(stream);
    expect(text).not.toContain("[REFERENCES");
    const result = await done;
    expect(result.references).toEqual([]);
  });

  it("onStepFinish 工具调用触发 [PROGRESS] 进度注入", async () => {
    mockConfig.emitStepFinish = true;
    const { stream } = await runNoteAgent(fakeSupabase, "user-1", "搜索一下");
    const text = await readAll(stream);
    expect(text).toContain("[PROGRESS:");
  });

  it("无工具调用时流内容保持原样，不注入任何标记", async () => {
    const { stream } = await runNoteAgent(fakeSupabase, "user-1", "你好");
    const text = await readAll(stream);
    expect(text).toBe("正在处理...");
    expect(text).not.toContain("[NOTE_CREATED");
    expect(text).not.toContain("[REFERENCES");
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

