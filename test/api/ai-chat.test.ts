import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/ai/chat/route";

// ---- mocks ----

const runNoteAgent = vi.fn();
const createClient = vi.fn();
const maybeCompressSession = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createClient(),
}));

vi.mock("@/lib/agent", () => ({
  runNoteAgent: (...args: unknown[]) => runNoteAgent(...args),
}));

vi.mock("@/lib/compress", () => ({
  maybeCompressSession: (...args: unknown[]) => maybeCompressSession(...args),
}));

vi.mock("@/lib/logger", () => {
  const noop = () => {};
  const ns = new Proxy({}, { get: () => noop });
  return { logger: { api: ns, agent: ns, tools: ns, db: ns, compress: ns } };
});

const encoder = new TextEncoder();

function makeRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/ai/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function mockStream() {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode("mock response"));
      controller.close();
    },
  });
}

/** chat_messages.insert 可编程 mock：幂等靠数据库唯一约束（23505）判断重复 */
const insertChatMessageMock = vi.fn();

function makeSupabase(overrides: Record<string, unknown> = {}) {
  return {
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }) },
    from: (table: string) => {
      if (table === "chat_sessions") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                single: async () => ({ data: { id: "s1", title: "测试会话", summary: null }, error: null }),
              }),
            }),
          }),
          update: () => ({ eq: () => ({}) }),
        };
      }
      if (table === "chat_messages") {
        return { insert: insertChatMessageMock };
      }
      if (table === "documents") {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({ data: { title: "文档", content: "内容" }, error: null }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  insertChatMessageMock.mockResolvedValue({ error: null });
  createClient.mockReturnValue(makeSupabase());
  runNoteAgent.mockResolvedValue({
    stream: mockStream(),
    done: Promise.resolve({ text: "mock response", usage: null, references: [] }),
  });
  maybeCompressSession.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---- tests ----

describe("POST /api/ai/chat", () => {
  it("未登录返回 401", async () => {
    createClient.mockReturnValue({
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    });
    const res = await POST(makeRequest({ prompt: "hi", sessionId: "s1" }));
    expect(res.status).toBe(401);
    expect(runNoteAgent).not.toHaveBeenCalled();
  });

  it("缺少 sessionId 返回 400", async () => {
    const res = await POST(makeRequest({ prompt: "hi" }));
    expect(res.status).toBe(400);
    expect(runNoteAgent).not.toHaveBeenCalled();
  });

  it("重复 requestId 落库触发唯一约束冲突返回 409（幂等防重）", async () => {
    // 同一 requestId 的 user 消息第二次插入触发 23505（assistant 落库不受影响）
    let userInsertCount = 0;
    insertChatMessageMock.mockImplementation((msg: { role: string }) => {
      if (msg.role === "user") {
        userInsertCount++;
        if (userInsertCount > 1) {
          return Promise.resolve({
            error: {
              code: "23505",
              message: 'duplicate key value violates unique constraint "idx_chat_messages_request_id"',
            },
          });
        }
      }
      return Promise.resolve({ error: null });
    });

    const body = { prompt: "hi", sessionId: "s1", requestId: "same-id" };
    const first = await POST(makeRequest(body));
    expect(first.status).toBe(200);

    const second = await POST(makeRequest(body));
    expect(second.status).toBe(409);
    // 幂等拒绝不应触发 agent
    expect(runNoteAgent).toHaveBeenCalledTimes(1);
  });

  it("requestId 携带到用户消息落库（幂等键）", async () => {
    await POST(makeRequest({ prompt: "hi", sessionId: "s1", requestId: "r-1" }));
    const insertArgs = insertChatMessageMock.mock.calls[0][0];
    expect(insertArgs).toMatchObject({
      role: "user",
      requestId: "r-1",
      sessionId: "s1",
      userId: "user-1",
    });
  });

  it("无 requestId 的请求落库为 NULL（不触发部分唯一索引，兼容旧客户端）", async () => {
    await POST(makeRequest({ prompt: "hi", sessionId: "s1" }));
    const insertArgs = insertChatMessageMock.mock.calls[0][0];
    expect(insertArgs.requestId).toBeNull();
  });

  it("不存在的会话返回 404", async () => {
    createClient.mockReturnValue({
      auth: { getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }) },
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              single: async () => ({ data: null, error: { message: "not found" } }),
            }),
          }),
        }),
      }),
    });
    const res = await POST(makeRequest({ prompt: "hi", sessionId: "ghost", requestId: "r-404" }));
    expect(res.status).toBe(404);
    expect(runNoteAgent).not.toHaveBeenCalled();
  });

  it("正常请求返回 200 流式响应", async () => {
    const res = await POST(
      makeRequest({ prompt: "你好", sessionId: "s1", requestId: "r-ok-1" })
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");
    expect(res.headers.get("Cache-Control")).toBe("no-cache");

    const text = await res.text();
    expect(text).toBe("mock response");
  });

  it("assistant 消息落库携带 token 统计", async () => {
    runNoteAgent.mockResolvedValue({
      stream: mockStream(),
      done: Promise.resolve({
        text: "回答",
        usage: { inputTokens: 10, outputTokens: 20 },
        references: [],
      }),
    });
    const res = await POST(makeRequest({ prompt: "hi", sessionId: "s1", requestId: "r-token" }));
    await res.text();
    // 等待 done 链的落库完成
    await vi.waitFor(() => {
      const assistantCall = insertChatMessageMock.mock.calls.find((c) => c[0].role === "assistant");
      expect(assistantCall).toBeDefined();
      expect(assistantCall![0]).toMatchObject({
        promptTokens: 10,
        completionTokens: 20,
        totalTokens: 30,
      });
    });
  });

  it("首个问题自动命名会话（新对话 → prompt 前 20 字）", async () => {
    const updateMock = vi.fn().mockResolvedValue({ error: null });
    createClient.mockReturnValue(
      makeSupabase({
        from: (table: string) => {
          if (table === "chat_sessions") {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    single: async () => ({ data: { id: "s1", title: "新对话", summary: null }, error: null }),
                  }),
                }),
              }),
              update: (fields: unknown) => {
                updateMock(fields);
                return { eq: () => ({}) };
              },
            };
          }
          if (table === "chat_messages") return { insert: insertChatMessageMock };
          if (table === "documents") {
            return {
              select: () => ({
                eq: () => ({
                  single: async () => ({ data: { title: "文档", content: "内容" }, error: null }),
                }),
              }),
            };
          }
          throw new Error(`unexpected table: ${table}`);
        },
      })
    );
    await POST(makeRequest({ prompt: "帮我写一篇关于 React 的文章", sessionId: "s1", requestId: "r-name" }));

    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: "帮我写一篇关于 React 的文章".slice(0, 20) })
    );
  });

  it("assistant 落库后触发上下文压缩检查", async () => {
    runNoteAgent.mockResolvedValue({
      stream: mockStream(),
      done: Promise.resolve({ text: "回答", usage: null, references: [] }),
    });
    const res = await POST(makeRequest({ prompt: "hi", sessionId: "s1", requestId: "r-compress" }));
    await res.text();
    await vi.waitFor(() => {
      expect(maybeCompressSession).toHaveBeenCalledWith(
        expect.anything(), "user-1", "s1",
      );
    });
  });

  it("会话已有摘要时传给 agent 注入", async () => {
    createClient.mockReturnValue(
      makeSupabase({
        from: (table: string) => {
          if (table === "chat_sessions") {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    single: async () => ({
                      data: { id: "s1", title: "会话", summary: "早期摘要" },
                      error: null,
                    }),
                  }),
                }),
              }),
              update: () => ({ eq: () => ({}) }),
            };
          }
          if (table === "chat_messages") return { insert: insertChatMessageMock };
          if (table === "documents") {
            return {
              select: () => ({
                eq: () => ({
                  single: async () => ({ data: { title: "文档", content: "内容" }, error: null }),
                }),
              }),
            };
          }
          throw new Error(`unexpected table: ${table}`);
        },
      })
    );
    const res = await POST(makeRequest({ prompt: "hi", sessionId: "s1", requestId: "r-sum" }));
    await res.text();

    const agentArgs = runNoteAgent.mock.calls[0][3] as { summary?: string };
    expect(agentArgs.summary).toBe("早期摘要");
  });
});
