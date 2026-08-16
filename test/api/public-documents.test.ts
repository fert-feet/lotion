// 公开预览端点单测：无鉴权，仅已发布文档可见
import { describe, it, expect, beforeEach, vi } from "vitest";
import type Database from "better-sqlite3";
import { GET } from "@/app/api/public/documents/[documentId]/route";

const state = vi.hoisted(() => ({ db: null as Database.Database | null }));

vi.mock("@/lib/local/sqlite", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/local/sqlite")>();
  return { ...actual, getDb: () => state.db! };
});

function ctx(id: string): { params: Promise<{ documentId: string }> } {
  return { params: Promise.resolve({ documentId: id }) };
}

beforeEach(async () => {
  const { initDatabase } = await import("@/lib/local/sqlite");
  const { default: Database } = await import("better-sqlite3");
  const db = new Database(":memory:");
  initDatabase(db);
  state.db = db;
});

describe("GET /api/public/documents/[documentId]", () => {
  it("已发布文档无鉴权可读", async () => {
    const { createUser, } = await import("@/lib/local/auth");
    const { createDocument, updateDocument } = await import("@/lib/local/db");
    const user = createUser(state.db!, "a@x.com", "password123");
    const id = createDocument(state.db!, user.id, "公开笔记");
    updateDocument(state.db!, id, { content: "正文", isPublished: true });

    const res = await GET(new Request("http://x"), ctx(id));
    expect(res.status).toBe(200);
    const doc = await res.json();
    expect(doc.title).toBe("公开笔记");
    expect(doc.isPublished).toBe(true);
  });

  it("未发布文档返回 404（不泄露存在性）", async () => {
    const { createUser } = await import("@/lib/local/auth");
    const { createDocument } = await import("@/lib/local/db");
    const user = createUser(state.db!, "a@x.com", "password123");
    const id = createDocument(state.db!, user.id, "私有笔记");

    expect((await GET(new Request("http://x"), ctx(id))).status).toBe(404);
  });

  it("不存在的文档返回 404", async () => {
    expect((await GET(new Request("http://x"), ctx("no-such-id"))).status).toBe(404);
  });
});
