// AI 回合快照（chat_messages.metadata）的解析与容错单测。
// 快照是从数据库读回来再渲染的数据：旧版本、被手工改坏、半截 JSON 都不能让面板崩，
// 解析失败必须退化成"纯文本时间线"。
import { describe, it, expect } from "vitest";
import {
  TURN_SNAPSHOT_VERSION,
  createTurnSnapshot,
  parseTurnSnapshot,
} from "@/lib/chat-snapshot";

describe("parseTurnSnapshot：宽容解析", () => {
  it("接受 JSON 字符串与已解析对象两种输入", () => {
    const snapshot = createTurnSnapshot();
    snapshot.durationMs = 1234;
    snapshot.parts.push({ kind: "text", chars: 5 });
    expect(parseTurnSnapshot(JSON.stringify(snapshot))?.durationMs).toBe(1234);
    expect(parseTurnSnapshot(snapshot)?.durationMs).toBe(1234);
  });

  it("非 JSON / 非对象 / 缺 parts 一律返回 null（调用方降级为纯文本）", () => {
    expect(parseTurnSnapshot("{不是 JSON")).toBeNull();
    expect(parseTurnSnapshot(null)).toBeNull();
    expect(parseTurnSnapshot(undefined)).toBeNull();
    expect(parseTurnSnapshot(42)).toBeNull();
    expect(parseTurnSnapshot({ version: 1 })).toBeNull();
  });

  it("未知 part 类型被跳过，已知类型按原顺序保留", () => {
    const parsed = parseTurnSnapshot({
      version: TURN_SNAPSHOT_VERSION,
      parts: [
        { kind: "text", chars: 3 },
        { kind: "unknown-future-kind" },
        { kind: "tool", seq: 1 },
        { kind: "todo" },
      ],
    });
    expect(parsed?.parts).toEqual([
      { kind: "text", chars: 3 },
      { kind: "tool", seq: 1 },
      { kind: "todo" },
    ]);
  });

  it("缺字段的卡片被补成安全默认值（不出现 undefined 渲染）", () => {
    const parsed = parseTurnSnapshot({
      parts: [{ kind: "tool", seq: 1 }],
      tools: [{ seq: 1 }],
      notes: [{ kind: "delete_confirm" }],
      questions: [{ options: [{ label: "A" }] }],
      todos: [{}],
    });
    expect(parsed?.tools[0]).toMatchObject({ tool: "", label: "", state: "done", summary: "" });
    expect(parsed?.notes[0]).toMatchObject({ kind: "delete_confirm", resolved: false });
    expect(parsed?.questions[0].options[0]).toEqual({ label: "A", description: "" });
    expect(parsed?.todos[0]).toEqual({ content: "", status: "pending" });
    expect(parsed?.errorMessage).toBeNull();
  });

  it("未知的 todo 状态收敛为 pending（不把非法状态渲染进 UI）", () => {
    const parsed = parseTurnSnapshot({ parts: [], todos: [{ content: "x", status: "weird" }] });
    expect(parsed?.todos[0].status).toBe("pending");
  });

  it("保留 error 快照（失败轮次刷新后仍是失败态）", () => {
    const parsed = parseTurnSnapshot({ parts: [], errorMessage: "重复工具调用已终止" });
    expect(parsed?.errorMessage).toBe("重复工具调用已终止");
  });
});
