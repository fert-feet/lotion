import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/ai/chat/route";

// ---- mocks ----

const runNoteAgent = vi.fn();
const createClient = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createClient(),
}));

vi.mock("@/lib/agent", () => ({
  runNoteAgent: (...args: unknown[]) => runNoteAgent(...args),
}));

vi.mock("@/lib/logger", () => {
  const noop = () => {};
  const ns = new Proxy({}, { get: () => noop });
  return { logger: { api: ns, agent: ns, tools: ns } };
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

function makeSupabase(overrides: Record<string, unknown> = {}) {
  return {
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }) },
    from: (table: string) => {
      if (table === "chat_sessions") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                single: async () => ({ data: { id: "s1", title: "测试会话" }, error: null }),
              }),
            }),
          }),
          update: () => ({ eq: () => ({}) }),
        };
      }
      if (table === "chat_messages") {
        return { insert: () => ({}) };
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
  createClient.mockReturnValue(makeSupabase());
  runNoteAgent.mockResolvedValue({
    stream: mockStream(),
    done: Promise.resolve({ text: "mock response", usage: null, references: [] }),
  });
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

  it("重复 requestId 返回 409（幂等防重）", async () => {
    const body = { prompt: "hi", sessionId: "s1", requestId: "same-id" };
    const first = await POST(makeRequest(body));
    expect(first.status).toBe(200);

    const second = await POST(makeRequest(body));
    expect(second.status).toBe(409);
    // 幂等拒绝不应触发 agent
    expect(runNoteAgent).toHaveBeenCalledTimes(1);
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

  it("相同 requestId 跨请求防重（不同 prompt 也拒绝）", async () => {
    await POST(makeRequest({ prompt: "a", sessionId: "s1", requestId: "shared" }));
    const res = await POST(makeRequest({ prompt: "b", sessionId: "s1", requestId: "shared" }));
    expect(res.status).toBe(409);
  });
});
