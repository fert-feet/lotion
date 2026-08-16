// doom loop 检测（对齐 SiYuan doomLoopTracker）与 [tool_output] 包裹单测：
// 相同工具+相同参数连续失败 → warn 阈值触发警告、stop 阈值触发终止；
// 成功调用重置基准；不同签名重新计数。
// 工具结果统一 [tool_output] 包裹（不可信数据声明）。
import { describe, expect, it, vi, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { openTestDb, isoNow } from "@/lib/local/sqlite";
import { createDocument } from "@/lib/local/db";
import {
  createDoomLoopTracker,
  createTools,
  DOOM_LOOP_WARN_THRESHOLD,
  DOOM_LOOP_STOP_THRESHOLD,
} from "@/lib/ai/tools";

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

describe("createDoomLoopTracker", () => {
  it("相同签名连续失败：warn 阈值触发警告，stop 阈值触发终止", () => {
    const warns: string[] = [];
    const stops: string[] = [];
    const doom = createDoomLoopTracker({
      onWarn: (name, count) => warns.push(`${name}:${count}`),
      onStop: (name, count) => stops.push(`${name}:${count}`),
    });

    for (let i = 0; i < DOOM_LOOP_STOP_THRESHOLD; i++) {
      doom.track("searchNotes", { query: "不存在" }, "failure");
    }

    expect(warns).toEqual([`searchNotes:${DOOM_LOOP_WARN_THRESHOLD}`]);
    expect(stops).toEqual([`searchNotes:${DOOM_LOOP_STOP_THRESHOLD}`]);
  });

  it("成功调用重置基准（不把后续合理调用连成重复）", () => {
    const warns: string[] = [];
    const doom = createDoomLoopTracker({ onWarn: (n, c) => warns.push(`${n}:${c}`) });

    doom.track("readNote", { noteId: "a" }, "failure");
    doom.track("readNote", { noteId: "a" }, "failure");
    doom.track("readNote", { noteId: "a" }, "ok"); // 成功 → 重置
    doom.track("readNote", { noteId: "a" }, "failure");
    doom.track("readNote", { noteId: "a" }, "failure");

    expect(warns).toEqual([]);
  });

  it("不同签名（参数变化）重新计数", () => {
    const warns: string[] = [];
    const doom = createDoomLoopTracker({ onWarn: (n, c) => warns.push(`${n}:${c}`) });

    doom.track("searchNotes", { query: "a" }, "failure");
    doom.track("searchNotes", { query: "b" }, "failure");
    doom.track("searchNotes", { query: "c" }, "failure");

    expect(warns).toEqual([]);
  });

  it("键序不同的等价参数视为同签名", () => {
    const warns: string[] = [];
    const doom = createDoomLoopTracker({ onWarn: (n, c) => warns.push(`${n}:${c}`) });

    doom.track("updateNote", { noteId: "x", content: "y" }, "failure");
    doom.track("updateNote", { content: "y", noteId: "x" }, "failure");
    doom.track("updateNote", { noteId: "x", content: "y" }, "failure");

    expect(warns).toEqual([`updateNote:${DOOM_LOOP_WARN_THRESHOLD}`]);
  });

  it("不同工具名不算重复", () => {
    const warns: string[] = [];
    const doom = createDoomLoopTracker({ onWarn: (n, c) => warns.push(`${n}:${c}`) });

    doom.track("readNote", { noteId: "a" }, "failure");
    doom.track("searchNotes", { query: "a" }, "failure");
    doom.track("getDocInfo", { noteId: "a" }, "failure");

    expect(warns).toEqual([]);
  });
});

describe("工具输出包裹与 doom 联动（createTools 层）", () => {
  it("工具结果统一 [tool_output] 包裹（返回给模型的文本）", async () => {
    const docId = createDocument(db, "u1", "目标笔记");
    const tools = createTools(db, "u1") as unknown as Record<
      string,
      { execute: (args: unknown, opts?: unknown) => Promise<unknown> }
    >;

    const res = await tools.readNote.execute!({ noteId: docId }, { toolCallId: "t1" });
    const text = String(res);
    expect(text.startsWith("[tool_output]\n")).toBe(true);
    expect(text.endsWith("[/tool_output]")).toBe(true);
    // 内部仍是模型可读的笔记内容
    expect(text).toContain("目标笔记");
  });

  it("工具失败结果同样包裹，且计入 doom loop（重复失败触发终止）", async () => {
    const stops: string[] = [];
    const doom = createDoomLoopTracker({ onStop: (n, c) => stops.push(`${n}:${c}`) });
    const tools = createTools(db, "u1", () => {}, doom) as unknown as Record<
      string,
      { execute: (args: unknown, opts?: unknown) => Promise<unknown> }
    >;

    for (let i = 0; i < DOOM_LOOP_STOP_THRESHOLD; i++) {
      const res = await tools.readNote.execute!({ noteId: "不存在-id" }, { toolCallId: `t${i}` });
      expect(String(res)).toContain("[tool_output]");
    }
    expect(stops).toEqual([`readNote:${DOOM_LOOP_STOP_THRESHOLD}`]);
  });
});
