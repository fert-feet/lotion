"use client";

// AI 会话列表的纯逻辑（可单测）：过滤 / 相对时间 / 输入框历史召回。
import type { ChatSession } from "@/lib/seams/doc-store";
import type { Turn } from "./types";

/** 标题过滤（大小写不敏感；空查询返回全部） */
export function filterSessions(sessions: ChatSession[], query: string): ChatSession[] {
  const q = query.trim().toLowerCase();
  if (!q) return sessions;
  return sessions.filter((s) => s.title.toLowerCase().includes(q));
}

/**
 * 会话列表按最近更新排序：updatedAt 缺失（本地乐观插入的新会话）排最前。
 * 不修改入参。
 */
export function sortSessionsByRecent(sessions: ChatSession[]): ChatSession[] {
  // 缺失/非法时间视为"最新"：面板里刚乐观插入的新会话就是这样（createdAt/updatedAt 为空）
  const ts = (s: ChatSession): number => {
    const t = Date.parse(s.updatedAt || "");
    return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
  };
  return [...sessions].sort((a, b) => ts(b) - ts(a));
}

/** 相对时间（now 可注入，便于单测） */
export function formatRelativeTime(iso: string | undefined, now: number = Date.now()): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const diff = now - t;
  if (diff < 0) return "刚刚";
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return "刚刚";
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`;
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`;
  if (diff < 7 * day) return `${Math.floor(diff / day)} 天前`;
  const d = new Date(t);
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
}

/**
 * 输入框「↑ 召回」的历史：本轮会话里用户发过的话，最新的在前。
 * 相同内容只保留最近一次（避免 ↑ 反复召回同一句）。
 */
export function recentUserMessages(turns: Turn[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    const content = turns[i].userContent.trim();
    if (!content || seen.has(content)) continue;
    seen.add(content);
    out.push(content);
  }
  return out;
}

/** 召回指针：从最新一条往回走，越界时停在两端（不循环，避免"转圈"迷惑用户） */
export function stepRecallIndex(current: number, total: number, delta: -1 | 1): number {
  if (total === 0) return -1;
  if (current < 0) return delta === -1 ? 0 : -1;
  const next = current + (delta === -1 ? 1 : -1);
  if (next < 0) return 0;
  if (next >= total) return total - 1;
  return next;
}
