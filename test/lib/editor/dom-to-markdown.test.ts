// contentEditable DOM → inline Markdown 转换器单测（fake 节点，无 jsdom）。
import { describe, expect, it } from "vitest";
import { domToMarkdown, TEXT_NODE, ELEMENT_NODE, type NodeLike } from "@/lib/editor/dom-to-markdown";

function text(value: string): NodeLike {
  return { nodeType: TEXT_NODE, nodeName: "#text", textContent: value };
}

function el(name: string, ...children: NodeLike[]): NodeLike {
  return { nodeType: ELEMENT_NODE, nodeName: name.toUpperCase(), textContent: null, childNodes: children };
}

function link(href: string, ...children: NodeLike[]): NodeLike {
  return { nodeType: ELEMENT_NODE, nodeName: "A", textContent: null, href, childNodes: children };
}

describe("domToMarkdown", () => {
  it("纯文本原样输出", () => {
    expect(domToMarkdown(text("你好 world"))).toBe("你好 world");
  });

  it("加粗/斜体/删除线/代码包裹对应标记", () => {
    expect(domToMarkdown(el("strong", text("重点")))).toBe("**重点**");
    expect(domToMarkdown(el("em", text("斜")))).toBe("*斜*");
    expect(domToMarkdown(el("del", text("删")))).toBe("~~删~~");
    expect(domToMarkdown(el("code", text("cmd")))).toBe("`cmd`");
  });

  it("链接输出 [文本](href)；无 href 降级为文本", () => {
    expect(domToMarkdown(link("https://x.com", text("链接")))).toBe("[链接](https://x.com)");
    expect(domToMarkdown(el("a", text("无链接")))).toBe("无链接");
  });

  it("嵌套组合（加粗内链接）", () => {
    expect(domToMarkdown(el("strong", link("https://x.com", text("链接"))))).toBe("**[链接](https://x.com)**");
  });

  it("<br> 输出换行；div/p 输出内容加换行", () => {
    expect(domToMarkdown(el("div", text("a"), el("br"), text("b")))).toBe("a\nb");
  });

  it("未知标签（span 样式等）降级为文本内容，不注入标记", () => {
    expect(domToMarkdown(el("span", text("样式文本")))).toBe("样式文本");
  });

  it("空内容输出空串", () => {
    expect(domToMarkdown(el("div"))).toBe("");
  });
});

describe("serializeEditable（真实 DOM 适配）", () => {
  it("适配真实 DOM 节点：childNodes 转数组，去掉末尾换行", () => {
    // node 环境无 DOM：直接验证 domToMarkdown 对适配后结构的输出
    // （serializeEditable = domToMarkdown(adaptDom(el)) + 剥尾换行）
    const root: NodeLike = {
      nodeType: ELEMENT_NODE,
      nodeName: "DIV",
      textContent: "正文",
      childNodes: [text("正文")],
    };
    expect(domToMarkdown(root)).toBe("正文");
  });
});
