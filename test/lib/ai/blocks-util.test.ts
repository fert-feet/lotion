// blocks-util 单测（重构阶段 B）：块 JSON 展平/取文本/类型标签 + 存量 Markdown 惰性转写回。
import { describe, expect, it, vi, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { openTestDb, newId, isoNow } from "@/lib/local/sqlite";
import { createDocument, updateDocument, getDocumentById } from "@/lib/local/db";
import {
  blockText,
  ensureDocBlocks,
  flattenBlocks,
  kindLabel,
  NO_CONTENT_BLOCK_TYPES,
  type AnyBlock,
} from "@/lib/ai/tools/blocks-util";

vi.mock("@/lib/logger", () => {
  const noop = () => {};
  const ns = new Proxy({}, { get: () => noop });
  return { logger: { api: ns, agent: ns, tools: ns, db: ns } };
});

let db: Database.Database;

beforeEach(() => {
  db = openTestDb();
  db.prepare(
    "INSERT INTO users (id, email, passwordHash, createdAt, updatedAt) VALUES (?,?,?,?,?)",
  ).run("u1", "u1@x.com", "hash", isoNow(), isoNow());
});

describe("flattenBlocks", () => {
  it("平铺块树：嵌套子块带点号序号", () => {
    const blocks: AnyBlock[] = [
      { id: "a", children: [{ id: "b", children: [] }] },
      { id: "c", children: [{ id: "d", children: [{ id: "e", children: [] }] }] },
    ];
    const flat = flattenBlocks(blocks);
    expect(flat.map(({ index, block }) => `${index}:${block.id}`)).toEqual([
      "0:a",
      "0.1:b",
      "1:c",
      "1.1:d",
      "1.1.1:e",
    ]);
  });
});

describe("blockText / kindLabel", () => {
  it("inline content 数组拼接文本；codeBlock 字符串原样", () => {
    expect(blockText({ content: [{ text: "a" }, { text: "b" }] })).toBe("ab");
    expect(blockText({ content: "代码内容" })).toBe("代码内容");
    expect(blockText({ content: undefined })).toBe("");
  });

  it("类型标签映射（含未知类型兜底）", () => {
    expect(kindLabel("heading")).toBe("标题");
    expect(kindLabel("checkListItem")).toBe("任务项");
    expect(kindLabel("customType")).toBe("customType");
    expect(kindLabel(undefined)).toBe("未知");
  });

  it("无内容块类型集合包含 divider/table/image 等", () => {
    expect(NO_CONTENT_BLOCK_TYPES.has("divider")).toBe(true);
    expect(NO_CONTENT_BLOCK_TYPES.has("paragraph")).toBe(false);
  });
});

describe("ensureDocBlocks", () => {
  it("BlockNote JSON 原样返回（不写回）", async () => {
    const content = JSON.stringify([{ id: "x", type: "paragraph", content: [{ text: "hi" }] }]);
    const id = createDocument(db, "u1", "笔记");
    updateDocument(db, "u1", id, { content });

    const { blocks } = (await ensureDocBlocks(db, "u1", id))!;
    expect(blocks[0].id).toBe("x");
    // 写库内容不变
    expect(getDocumentById(db, id, "u1")!.content).toBe(content);
  });

  it("存量 Markdown 惰性转换并写回 JSON：块 ID 持久化（多次调用 ID 稳定）", async () => {
    const id = createDocument(db, "u1", "MD");
    updateDocument(db, "u1", id, { content: "# 标题\n\n正文" });

    const first = (await ensureDocBlocks(db, "u1", id))!;
    expect(first.blocks[0].id).toBeTruthy();
    // 已写回 JSON
    expect(getDocumentById(db, id, "u1")!.content).toContain('"id"');

    const second = (await ensureDocBlocks(db, "u1", id))!;
    expect(second.blocks[0].id).toBe(first.blocks[0].id); // 稳定
    expect(second.blocks).toHaveLength(2);
  });

  it("文档不存在 / 跨用户返回 null", async () => {
    const foreign = createDocument(db, "u1", "别的");
    expect(await ensureDocBlocks(db, "u1", newId())).toBeNull();
    expect(await ensureDocBlocks(db, "u2", foreign)).toBeNull();
  });
});
