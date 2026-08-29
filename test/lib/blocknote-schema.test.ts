// blocknote-schema 单测（P1）：自定义 Callout 块在 schema 中注册，
// 且服务端 toBlocks/toMarkdown 对含 callout 的 JSON 读写一致。
import { describe, expect, it } from "vitest";
import { lotionSchema } from "@/lib/blocknote-schema";
import { toBlocks, toMarkdown } from "@/lib/content-server";

const CALLOUT_JSON = JSON.stringify([
  {
    id: "c-1",
    type: "callout",
    props: { icon: "⚠️" },
    content: [{ type: "text", text: "这是一条提醒", styles: {} }],
    children: [],
  },
  {
    id: "p-1",
    type: "paragraph",
    content: [{ type: "text", text: "普通段落", styles: {} }],
    children: [],
  },
]);

describe("lotionSchema", () => {
  it("扩展了 callout 块（默认块保留）", () => {
    expect(lotionSchema.blockSchema).toHaveProperty("callout");
    expect(lotionSchema.blockSchema).toHaveProperty("paragraph");
    expect(lotionSchema.blockSchema).toHaveProperty("heading");
  });
});

describe("callout 服务端转换", () => {
  it("toBlocks 原样解析含 callout 的 JSON（类型与 icon 保留）", async () => {
    const blocks = await toBlocks(CALLOUT_JSON);
    expect(blocks[0].type).toBe("callout");
    expect((blocks[0].props as { icon: string }).icon).toBe("⚠️");
    expect(blocks[1].type).toBe("paragraph");
  });

  it("toMarkdown 对含 callout 的 JSON 不抛错且保留文本内容", async () => {
    const md = await toMarkdown(CALLOUT_JSON);
    expect(md).toContain("这是一条提醒");
    expect(md).toContain("普通段落");
  });
});

describe("mention 内联内容", () => {
  const MENTION_JSON = JSON.stringify([
    {
      id: "p-1",
      type: "paragraph",
      content: [
        { type: "text", text: "参见 ", styles: {} },
        { type: "mention", props: { id: "doc-1", title: "搬家清单" }, styles: {} },
        { type: "text", text: " 的说明", styles: {} },
      ],
      children: [],
    },
  ]);

  it("schema 注册 mention；toBlocks 解析保留 id/title", async () => {
    expect(lotionSchema.inlineContentSchema).toHaveProperty("mention");
    const blocks = await toBlocks(MENTION_JSON);
    const content = blocks[0].content as Array<{ type: string; props?: { id?: string; title?: string } }>;
    const mention = content.find((c) => c.type === "mention");
    expect(mention?.props?.id).toBe("doc-1");
    expect(mention?.props?.title).toBe("搬家清单");
  });

  it("toMarkdown 对含 mention 的 JSON 保留标题文本", async () => {
    const md = await toMarkdown(MENTION_JSON);
    expect(md).toContain("搬家清单");
  });
});
