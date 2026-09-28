// POST /api/ai/chat 单测：真实内存 SQLite + 真实幂等唯一索引，
// agent / 压缩为 mock（其内部行为由各自的单测覆盖）。
// 迁移自直连 Next.js Route Handler 的写法——经 Hono app.request 走真实路由。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type Database from "better-sqlite3";
import { SESSION_COOKIE } from "@/lib/local/auth";
import { createApiTestApp } from "../mocks/api-app";

// ---- mocks ----

const runNoteAgent = vi.fn();
const maybeCompressSession = vi.fn();

vi.mock("@/lib/agent", () => ({
  runNoteAgent: (...args: unknown[]) => runNoteAgent(...args),
}));

vi.mock("@/lib/compress", () => ({
  maybeCompressSession: (...args: unknown[]) => maybeCompressSession(...args),
  WINDOW_SIZE: 100,
}));

vi.mock("@/lib/logger", () => {
  const noop = () => {};
  const ns = new Proxy({}, { get: () => noop });
  return { logger: { api: ns, agent: ns, tools: ns, db: ns, compress: ns } };
});

const state = vi.hoisted(() => ({ db: null as Database.Database | null }));

vi.mock("@/lib/local/sqlite", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/local/sqlite")>();
  return { ...actual, getDb: () => state.db! };
});

// ---- helpers ----

let app: Awaited<ReturnType<typeof createApiTestApp>>["app"];
const encoder = new TextEncoder();

function postChat(body: Record<string, unknown>, cookie?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cookie) headers.cookie = cookie;
  return app.request("/api/ai/chat", {
    method: "POST",
    headers,
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

/** 注册用户并种会话 cookie，同时建一个 AI 会话（默认标题 新对话） */
async function seedAuth(): Promise<{ cookie: string; userId: string; sessionId: string }> {
  const { createUser, createSession } = await import("@/lib/local/auth");
  const { createChatSession } = await import("@/lib/local/db");
  const user = createUser(state.db!, "a@x.com", "password123");
  const token = createSession(state.db!, user.id);
  const sessionId = createChatSession(state.db!, user.id);
  return { cookie: `${SESSION_COOKIE}=${token}`, userId: user.id, sessionId };
}

beforeEach(async () => {
  const { initDatabase } = await import("@/lib/local/sqlite");
  const { default: Database } = await import("better-sqlite3");
  const db = new Database(":memory:");
  initDatabase(db);
  state.db = db;

  vi.clearAllMocks();
  runNoteAgent.mockResolvedValue({
    stream: mockStream(),
    done: Promise.resolve({ text: "mock response", usage: null, references: [] }),
  });
  maybeCompressSession.mockResolvedValue(undefined);

  ({ app } = await createApiTestApp());
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---- tests ----

describe("POST /api/ai/chat", () => {
  it("未登录返回 401", async () => {
    const res = await postChat({ prompt: "hi", sessionId: "s1" });
    expect(res.status).toBe(401);
    expect(runNoteAgent).not.toHaveBeenCalled();
  });

  it("缺少 sessionId/prompt 返回 400", async () => {
    const { cookie } = await seedAuth();
    expect((await postChat({ prompt: "hi" }, cookie)).status).toBe(400);
    expect(runNoteAgent).not.toHaveBeenCalled();
  });

  it("重复 requestId 落库触发唯一约束返回 409（真实 SQLite 唯一索引）", async () => {
    const { cookie, sessionId } = await seedAuth();
    const body = { prompt: "hi", sessionId, requestId: "same-id" };
    const first = await postChat(body, cookie);
    expect(first.status).toBe(200);

    const second = await postChat(body, cookie);
    expect(second.status).toBe(409);
    // 幂等拒绝不应再次触发 agent
    expect(runNoteAgent).toHaveBeenCalledTimes(1);
  });

  it("不存在的会话返回 404", async () => {
    const { cookie } = await seedAuth();
    const res = await postChat({ prompt: "hi", sessionId: "ghost-id" }, cookie);
    expect(res.status).toBe(404);
    expect(runNoteAgent).not.toHaveBeenCalled();
  });

  it("跨用户会话返回 404（归属校验）", async () => {
    const { sessionId } = await seedAuth();
    const { createUser, createSession } = await import("@/lib/local/auth");
    const b = createUser(state.db!, "b@x.com", "password123");
    const tokenB = createSession(state.db!, b.id);
    const res = await postChat({ prompt: "hi", sessionId }, `${SESSION_COOKIE}=${tokenB}`);
    expect(res.status).toBe(404);
  });

  it("正常请求返回 200 流式响应并落库 user/assistant 两条消息", async () => {
    const { cookie, sessionId } = await seedAuth();
    const res = await postChat({ prompt: "你好", sessionId, requestId: "r-ok-1" }, cookie);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");
    expect(res.headers.get("Cache-Control")).toBe("no-cache");
    expect(await res.text()).toBe("mock response");

    await vi.waitFor(() => {
      const rows = state.db!
        .prepare("SELECT role FROM chat_messages WHERE sessionId = ? ORDER BY rowid")
        .all(sessionId) as { role: string }[];
      expect(rows.map((r) => r.role)).toEqual(["user", "assistant"]);
    });
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
    const { cookie, sessionId } = await seedAuth();
    const res = await postChat({ prompt: "hi", sessionId, requestId: "r-token" }, cookie);
    await res.text();

    await vi.waitFor(() => {
      const row = state.db!
        .prepare(
          "SELECT promptTokens, completionTokens, totalTokens FROM chat_messages WHERE sessionId = ? AND role = 'assistant'",
        )
        .get(sessionId) as { promptTokens: number; completionTokens: number; totalTokens: number };
      expect(row).toMatchObject({ promptTokens: 10, completionTokens: 20, totalTokens: 30 });
    });
  });

  it("首个问题自动命名会话（新对话 → prompt 前 20 字）", async () => {
    const { cookie, sessionId } = await seedAuth();
    const prompt = "帮我写一篇关于 React 的文章";
    await postChat({ prompt, sessionId, requestId: "r-name" }, cookie);

    const row = state.db!
      .prepare("SELECT title FROM chat_sessions WHERE id = ?")
      .get(sessionId) as { title: string };
    expect(row.title).toBe(prompt.slice(0, 20));
  });

  it("assistant 落库后触发上下文压缩检查（新签名 userId, sessionId[, { ai }]）", async () => {
    const { cookie, sessionId, userId } = await seedAuth();
    const res = await postChat({ prompt: "hi", sessionId, requestId: "r-compress" }, cookie);
    await res.text();

    await vi.waitFor(() => {
      // 第三参是 AI 运行期配置（来自配置层）；本用例未装配宿主内核 → undefined（消费方回退环境变量）
      expect(maybeCompressSession).toHaveBeenCalledWith(userId, sessionId, undefined);
    });
  });

  it("会话已有摘要时传给 agent 注入", async () => {
    const { cookie, sessionId, userId } = await seedAuth();
    const { setChatSessionSummary } = await import("@/lib/local/db");
    setChatSessionSummary(state.db!, userId, sessionId, "早期摘要");

    const res = await postChat({ prompt: "hi", sessionId, requestId: "r-sum" }, cookie);
    await res.text();

    const agentArgs = runNoteAgent.mock.calls[0][3] as { summary?: string };
    expect(agentArgs.summary).toBe("早期摘要");
  });

  it("带 documentId 时按归属查出当前文档并传给 agent（用户不必再 @ 一次）", async () => {
    const { cookie, sessionId, userId } = await seedAuth();
    const { createDocument, updateDocument } = await import("@/lib/local/db");
    const docId = createDocument(state.db!, userId, "周会纪要");
    updateDocument(state.db!, docId, { content: "正文" });

    const res = await postChat({ prompt: "总结这篇", sessionId, requestId: "r-doc", documentId: docId }, cookie);
    await res.text();

    const agentArgs = runNoteAgent.mock.calls[0][3] as {
      currentDocument?: { id: string; title: string };
    };
    expect(agentArgs.currentDocument).toEqual({ id: docId, title: "周会纪要" });
  });

  it("documentId 不属于当前用户时静默降级（不把别人的文档带进上下文）", async () => {
    const { cookie, sessionId } = await seedAuth();
    const { createUser } = await import("@/lib/local/auth");
    const { createDocument } = await import("@/lib/local/db");
    const other = createUser(state.db!, "other@x.com", "password123");
    const otherDoc = createDocument(state.db!, other.id, "别人的笔记");

    const res = await postChat(
      { prompt: "总结这篇", sessionId, requestId: "r-doc-other", documentId: otherDoc },
      cookie,
    );
    expect(res.status).toBe(200);
    await res.text();

    const agentArgs = runNoteAgent.mock.calls[0][3] as { currentDocument?: unknown };
    expect(agentArgs.currentDocument).toBeUndefined();
  });

  it("documentId 指向不存在的文档时也照常生成（不 4xx）", async () => {
    const { cookie, sessionId } = await seedAuth();
    const res = await postChat(
      { prompt: "hi", sessionId, requestId: "r-doc-missing", documentId: "ghost" },
      cookie,
    );
    expect(res.status).toBe(200);
    await res.text();
    const agentArgs = runNoteAgent.mock.calls[0][3] as { currentDocument?: unknown };
    expect(agentArgs.currentDocument).toBeUndefined();
  });

  it("AI 的隐式改动落库到 ai_changes（撤销依赖它）", async () => {
    runNoteAgent.mockResolvedValue({
      stream: mockStream(),
      done: Promise.resolve({
        text: "改好了",
        usage: null,
        references: [],
        snapshot: {
          version: 1,
          durationMs: 1,
          errorMessage: null,
          changedDocuments: [],
          requestId: null,
          parts: [],
          tools: [],
          notes: [],
          references: [],
          questions: [],
          todos: [],
          warnings: [],
        },
        changes: [
          {
            documentId: "doc-x",
            before: {
              title: "旧标题",
              content: "旧内容",
              icon: null,
              coverImage: null,
              parentDocument: null,
              isPublished: false,
              isArchived: false,
            },
          },
        ],
      }),
    });
    const { cookie, sessionId } = await seedAuth();
    const res = await postChat({ prompt: "改标题", sessionId, requestId: "r-change" }, cookie);
    await res.text();

    await vi.waitFor(() => {
      const row = state.db!
        .prepare("SELECT documentId, beforeState FROM ai_changes WHERE requestId = ?")
        .get("r-change") as { documentId: string; beforeState: string };
      expect(row.documentId).toBe("doc-x");
      expect(JSON.parse(row.beforeState).title).toBe("旧标题");
    });
  });

  it("assistant 消息落库携带回合快照（刷新后工具卡/引用/耗时都能重建）", async () => {
    runNoteAgent.mockResolvedValue({
      stream: mockStream(),
      done: Promise.resolve({
        text: "回答",
        usage: null,
        references: [],
        snapshot: {
          version: 1,
          durationMs: 777,
          errorMessage: null,
          parts: [{ kind: "text", chars: 2 }],
          tools: [],
          notes: [],
          references: [],
          questions: [],
          todos: [],
          warnings: [],
        },
      }),
    });
    const { cookie, sessionId } = await seedAuth();
    const res = await postChat({ prompt: "hi", sessionId, requestId: "r-snapshot" }, cookie);
    await res.text();

    await vi.waitFor(() => {
      const row = state.db!
        .prepare(
          "SELECT metadata FROM chat_messages WHERE sessionId = ? AND role = 'assistant'",
        )
        .get(sessionId) as { metadata: string | null };
      expect(JSON.parse(row.metadata!)).toMatchObject({ version: 1, durationMs: 777 });
    });
  });
});
