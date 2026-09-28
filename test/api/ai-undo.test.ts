// /api/ai/undo 单测：撤销一轮 AI 的隐式文档改动。
// 关键语义：只撤销自己的改动（显式 userId 过滤）、幂等、坏快照不掀桌。
import { describe, it, expect, beforeEach, vi } from "vitest";
import type Database from "better-sqlite3";
import { SESSION_COOKIE } from "@/lib/local/auth";
import { createApiTestApp } from "../mocks/api-app";

const state = vi.hoisted(() => ({ db: null as Database.Database | null }));

vi.mock("@/lib/local/sqlite", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/local/sqlite")>();
  return { ...actual, getDb: () => state.db! };
});

let app: Awaited<ReturnType<typeof createApiTestApp>>["app"];

async function authCookie(email = "undo@x.com"): Promise<{ cookie: string; userId: string }> {
  const { createUser, createSession } = await import("@/lib/local/auth");
  const user = createUser(state.db!, email, "password123");
  const token = createSession(state.db!, user.id);
  return { cookie: `${SESSION_COOKIE}=${token}`, userId: user.id };
}

function call(path: string, method: string, cookie?: string, body?: unknown) {
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) headers["content-type"] = "application/json";
  return app.request(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(async () => {
  const { initDatabase } = await import("@/lib/local/sqlite");
  const { default: Database } = await import("better-sqlite3");
  const db = new Database(":memory:");
  initDatabase(db);
  state.db = db;
  ({ app } = await createApiTestApp());
});

describe("POST /api/ai/undo", () => {
  it("把该轮改动过的文档恢复到改动前（标题/正文/发布态）", async () => {
    const { cookie, userId } = await authCookie();
    const { createDocument, updateDocument, getDocumentById, insertAiChange } = await import(
      "@/lib/local/db"
    );
    const docId = createDocument(state.db!, userId, "原标题");
    updateDocument(state.db!, docId, { content: "原内容" });
    const before = getDocumentById(state.db!, docId, userId)!;

    insertAiChange(state.db!, {
      userId,
      requestId: "req-undo-1",
      documentId: docId,
      beforeState: JSON.stringify({
        title: before.title,
        content: before.content,
        icon: before.icon,
        coverImage: before.coverImage,
        parentDocument: before.parentDocument,
        isPublished: before.isPublished,
        isArchived: before.isArchived,
      }),
    });
    updateDocument(state.db!, docId, { title: "AI 标题", content: "AI 内容", isPublished: true });

    const res = await call("/api/ai/undo", "POST", cookie, { requestId: "req-undo-1" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, restored: [docId], skipped: 0 });

    const after = getDocumentById(state.db!, docId, userId)!;
    expect(after.title).toBe("原标题");
    expect(after.content).toBe("原内容");
    expect(after.isPublished).toBe(false);
  });

  it("幂等：同一 requestId 再撤一次返回空 restored", async () => {
    const { cookie, userId } = await authCookie();
    const { createDocument, insertAiChange } = await import("@/lib/local/db");
    const docId = createDocument(state.db!, userId, "文档");
    insertAiChange(state.db!, {
      userId,
      requestId: "req-undo-2",
      documentId: docId,
      beforeState: JSON.stringify({ title: "文档" }),
    });

    expect(await (await call("/api/ai/undo", "POST", cookie, { requestId: "req-undo-2" })).json()).toMatchObject(
      { restored: [docId] },
    );
    expect(await (await call("/api/ai/undo", "POST", cookie, { requestId: "req-undo-2" })).json()).toEqual({
      ok: true,
      restored: [],
      skipped: 0,
    });
  });

  it("只能撤销自己的改动（别人的 requestId 无效）", async () => {
    const a = await authCookie("undo-a@x.com");
    const b = await authCookie("undo-b@x.com");
    const { createDocument, updateDocument, getDocumentById, insertAiChange } = await import(
      "@/lib/local/db"
    );
    const docId = createDocument(state.db!, b.userId, "B 的文档");
    insertAiChange(state.db!, {
      userId: b.userId,
      requestId: "req-undo-b",
      documentId: docId,
      beforeState: JSON.stringify({ title: "B 的旧标题" }),
    });
    updateDocument(state.db!, docId, { title: "被 AI 改过" });

    const res = await call("/api/ai/undo", "POST", a.cookie, { requestId: "req-undo-b" });
    expect(await res.json()).toEqual({ ok: true, restored: [], skipped: 0 });
    expect(getDocumentById(state.db!, docId, b.userId)!.title).toBe("被 AI 改过");
  });

  it("缺少 requestId 返回 400，未登录返回 401", async () => {
    const { cookie } = await authCookie();
    expect((await call("/api/ai/undo", "POST", cookie, {})).status).toBe(400);
    expect((await call("/api/ai/undo", "POST", undefined, { requestId: "x" })).status).toBe(401);
  });

  it("GET /api/ai/undo/:requestId 报告是否还有可撤销改动", async () => {
    const { cookie, userId } = await authCookie();
    const { insertAiChange, createDocument } = await import("@/lib/local/db");
    const docId = createDocument(state.db!, userId, "文档");
    insertAiChange(state.db!, {
      userId,
      requestId: "req-check",
      documentId: docId,
      beforeState: JSON.stringify({ title: "文档" }),
    });

    expect(await (await call("/api/ai/undo/req-check", "GET", cookie)).json()).toEqual({
      canUndo: true,
      documents: [docId],
    });
    await call("/api/ai/undo", "POST", cookie, { requestId: "req-check" });
    expect(await (await call("/api/ai/undo/req-check", "GET", cookie)).json()).toEqual({
      canUndo: false,
      documents: [],
    });
  });
});
