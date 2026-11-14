// 内置表情集：搜索、分组、数据完整性（替代 emoji-picker-react 的 ~680 KB 依赖）。
import { describe, it, expect } from "vitest";
import { ALL_EMOJIS, EMOJI_GROUPS, searchEmojis } from "@/components/emoji-data";

describe("emoji-data", () => {
  it("分组齐全且没有重复表情（重复会导致 React key 冲突）", () => {
    expect(EMOJI_GROUPS.map((g) => g.id)).toEqual(["doc", "idea", "people", "nature", "life", "marks"]);
    const all = ALL_EMOJIS.map((e) => e.emoji);
    expect(new Set(all).size).toBe(all.length);
    // 精简集：足够覆盖图标场景，但远小于全量（全量 1800+）
    expect(all.length).toBeGreaterThan(100);
    expect(all.length).toBeLessThan(300);
  });

  it("空查询返回全部；中文关键词可命中", () => {
    expect(searchEmojis("")).toHaveLength(ALL_EMOJIS.length);
    expect(searchEmojis("想法")).toContain("💡");
    expect(searchEmojis("完成")).toContain("✅");
    expect(searchEmojis("回收站")).toContain("🗑️");
  });

  it("英文关键词与表情本身也能命中；无命中返回空数组", () => {
    expect(searchEmojis("bug")).toContain("🐛");
    expect(searchEmojis("💡")).toEqual(["💡"]);
    expect(searchEmojis("这个词肯定没有")).toEqual([]);
  });

  it("每个表情都有关键词（否则只能靠表情本身搜到）", () => {
    for (const item of ALL_EMOJIS) {
      expect(item.keywords.trim().length, `${item.emoji} 缺少关键词`).toBeGreaterThan(0);
    }
  });
});
