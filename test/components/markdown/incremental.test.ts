// 增量块级解析器单测（对齐 DSH incremental 行为）：
// 追加式流中每帧冻结除末尾 2 块外的全部块、key 跨帧稳定、非追加输入重置 generation。
import { describe, expect, it } from "vitest";
import { IncrementalMarkdownParser } from "@/components/markdown/incremental";
import { parseGfm } from "@/components/markdown/parse";

describe("IncrementalMarkdownParser", () => {
  it("追加式更新：早期块冻结，key 为源偏移且跨帧稳定", () => {
    const parser = new IncrementalMarkdownParser(parseGfm);
    const first = parser.update("# 标题\n\n第一段\n\n第二段\n\n第三段");
    // 4 块：除末尾 2 块外全部冻结 → frozen 2 / tail 2
    expect(first.frozen).toHaveLength(2);
    expect(first.tail).toHaveLength(2);

    const second = parser.update("# 标题\n\n第一段\n\n第二段\n\n第三段\n\n第四段");
    // 5 块：前 3 块冻结，尾部 2 块
    expect(second.frozen).toHaveLength(3);
    expect(second.tail).toHaveLength(2);
    // 冻结块 key = 各自源偏移（0 / 后续，稳定递增）
    const keys = second.frozen.map((b) => b.key);
    expect(keys[0]).toBe(0);
    expect(keys[1] > keys[0]).toBe(true);
    expect(keys[2] > keys[1]).toBe(true);
    // 尾部第一块的 key 接续冻结块之后
    expect(second.tail[0].key > keys[keys.length - 1]).toBe(true);
  });

  it("尾部块被重塑（表格增长）时已冻结块不变化", () => {
    const parser = new IncrementalMarkdownParser(parseGfm);
    const frozenBase = parser.update("# 标题\n\n第一段\n\n| a | b |\n| --- | --- |\n| 1 | 2 |");
    // 3 块（heading/paragraph/table）：heading 冻结，其余在尾部
    expect(frozenBase.frozen.map((b) => b.key)).toEqual([0]);

    const grown = parser.update("# 标题\n\n第一段\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |");
    expect(grown.frozen.map((b) => b.key)).toEqual([0]); // heading 冻结 key 不变
    expect(grown.generation).toBe(frozenBase.generation);
  });

  it("非追加输入（前缀变化）重置：generation 自增、冻结缓存清空", () => {
    const parser = new IncrementalMarkdownParser(parseGfm);
    const a = parser.update("第一段\n\n第二段\n\n第三段");
    expect(a.generation).toBe(0);

    // 前缀被改写（非 append）：必须重新解析全部
    const b = parser.update("改写第一段\n\n第二段\n\n第三段");
    expect(b.generation).toBe(1);
    // 重置后按新文本重新冻结（3 块 → frozen 1 / tail 2）
    expect(b.frozen.map((x) => x.key)).toEqual([0]);
    expect(b.tail).toHaveLength(2);
  });

  it("相同文本幂等：返回缓存结果（引用相等）", () => {
    const parser = new IncrementalMarkdownParser(parseGfm);
    const a = parser.update("hello\n\nworld");
    const b = parser.update("hello\n\nworld");
    expect(b).toBe(a);
  });

  it("生成结果与一次性全量解析的块边界一致（GFM 表格）", () => {
    const text = "第一段\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n结尾";
    const parser = new IncrementalMarkdownParser(parseGfm);
    // 两步到达：先推送表格前文本，再推送全文
    parser.update("第一段");
    const full = parser.update(text);
    const all = [...full.frozen, ...full.tail];
    const expected = parseGfm(text).children;
    expect(all.map((b) => b.node.type)).toEqual(expected.map((n) => n.type));
  });
});
