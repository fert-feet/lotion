// AI 会话列表与输入框召回的纯逻辑单测。
import { describe, it, expect } from "vitest";
import type { ChatSession } from "@/lib/seams/doc-store";
import {
  filterSessions,
  filterSessionsByScope,
  formatRelativeTime,
  recentUserMessages,
  sortSessionsByRecent,
  stepRecallIndex,
} from "@/src/shell/ai/session-utils";
import { createTurn } from "@/src/shell/ai/types";

const session = (id: string, title: string, updatedAt = ""): ChatSession => ({
  id,
  title,
  createdAt: "",
  updatedAt,
});

describe("filterSessions / sortSessionsByRecent", () => {
  const list = [session("1", "React 学习"), session("2", "周会纪要"), session("3", "react 性能")];

  it("按标题过滤，大小写不敏感；空查询返回全部", () => {
    expect(filterSessions(list, "react").map((s) => s.id)).toEqual(["1", "3"]);
    expect(filterSessions(list, "  ").map((s) => s.id)).toEqual(["1", "2", "3"]);
    expect(filterSessions(list, "不存在的")).toEqual([]);
  });

  it("按 updatedAt 倒序排列；缺失时间的（刚乐观插入的新会话）排最前，且不改入参", () => {
    const input = [
      session("old", "旧", "2024-01-01T00:00:00.000Z"),
      session("new", "新", "2024-06-01T00:00:00.000Z"),
      session("fresh", "刚建的"),
    ];
    expect(sortSessionsByRecent(input).map((s) => s.id)).toEqual(["fresh", "new", "old"]);
    expect(input.map((s) => s.id)).toEqual(["old", "new", "fresh"]);
  });
});

describe("filterSessionsByScope", () => {
  const list = [
    { ...session("1", "全局"), documentId: null },
    { ...session("2", "文档 A"), documentId: "doc-a" },
    { ...session("3", "文档 B"), documentId: "doc-b" },
  ];

  it("all 全部；document 只看当前文档；没有打开文档时 document 为空", () => {
    expect(filterSessionsByScope(list, "all", "doc-a").map((s) => s.id)).toEqual(["1", "2", "3"]);
    expect(filterSessionsByScope(list, "document", "doc-a").map((s) => s.id)).toEqual(["2"]);
    expect(filterSessionsByScope(list, "document", null)).toEqual([]);
  });

  it("global 只看未绑定文档的会话", () => {
    expect(filterSessionsByScope(list, "global", "doc-a").map((s) => s.id)).toEqual(["1"]);
  });
});

describe("formatRelativeTime", () => {
  const now = Date.parse("2024-06-10T12:00:00.000Z");
  const at = (iso: string) => formatRelativeTime(iso, now);

  it("刚刚 / 分钟 / 小时 / 天 / 日期", () => {
    expect(at("2024-06-10T11:59:40.000Z")).toBe("刚刚");
    expect(at("2024-06-10T11:30:00.000Z")).toBe("30 分钟前");
    expect(at("2024-06-10T08:00:00.000Z")).toBe("4 小时前");
    expect(at("2024-06-07T12:00:00.000Z")).toBe("3 天前");
    expect(at("2024-05-01T12:00:00.000Z")).toBe("5 月 1 日");
  });

  it("空值 / 非法值返回空串（渲染不出现 Invalid Date）", () => {
    expect(formatRelativeTime(undefined, now)).toBe("");
    expect(formatRelativeTime("", now)).toBe("");
    expect(formatRelativeTime("不是时间", now)).toBe("");
  });
});

describe("recentUserMessages / stepRecallIndex", () => {
  it("最新的在前，重复内容只留最近一次，空内容忽略", () => {
    const turns = [createTurn("第一句"), createTurn("第二句"), createTurn("第一句"), createTurn("  ")];
    expect(recentUserMessages(turns)).toEqual(["第一句", "第二句"]);
  });

  it("召回指针从最新往回走并在两端夹住（不循环）", () => {
    expect(stepRecallIndex(-1, 3, -1)).toBe(0);
    expect(stepRecallIndex(0, 3, -1)).toBe(1);
    expect(stepRecallIndex(2, 3, -1)).toBe(2);
    expect(stepRecallIndex(1, 3, 1)).toBe(0);
    expect(stepRecallIndex(0, 3, 1)).toBe(0);
    expect(stepRecallIndex(-1, 0, -1)).toBe(-1);
  });
});
