// markdown 渲染器单测（对齐 DSH markdown-dom-parity 思路）：
// react-dom/server 在 node 环境渲染 MarkdownText，断言产出 DOM 结构。
// 覆盖：GFM 表格/删除线/任务列表、CJK 加粗、链接/图片安全策略、raw HTML
// 字面化、mention 胶囊、代码块、流式与定稿一致性。
// （用 createElement 而非 JSX：vitest 4 + vite 8/rolldown 对测试入口的
//   JSX 转换不稳定，createElement 对渲染输出无影响）
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MarkdownText } from "@/components/markdown/MarkdownText";

function render(text: string, onOpenDocument?: (id: string) => void): string {
  return renderToStaticMarkup(
    createElement(MarkdownText, { text, streaming: false, onOpenDocument }),
  );
}

describe("markdown 渲染（对齐 DSH）", () => {
  it("GFM 表格渲染为 table/thead/tbody，表头用 th", () => {
    const html = render("| 标题 | 更新时间 |\n| --- | --- |\n| Untitled | 15:53 |\n| 指南 | 14:45 |");
    expect(html).toContain("<table>");
    expect(html).toContain("<thead>");
    expect(html).toContain("<th>");
    expect(html).toContain("<tbody>");
    expect(html).toContain("<td>Untitled</td>");
    expect(html).toContain("<td>15:53</td>");
    // 表格包在横向滚动容器中（对齐 DSH tableScroll）
    expect(html).toMatch(/class="md-table-scroll"/);
  });

  it("表格列对齐转为行内 textAlign 样式", () => {
    const html = render("| a | b |\n| :-: | --- |\n| 1 | 2 |");
    expect(html).toContain('style="text-align:center"');
    expect(html).toContain('<th style="text-align:center">a</th>');
    expect(html).toContain("<th>b</th>");
  });

  it("CJK 加粗：**中文**（标点后无空白闭合）渲染为 strong", () => {
    const html = render("这是**重要内容**。");
    expect(html).toContain("<strong>重要内容</strong>");
  });

  it("普通加粗 / 斜体 / 删除线", () => {
    const html = render("**bold** *em* ~~gone~~");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>em</em>");
    expect(html).toContain("<del>gone</del>");
  });

  it("任务列表渲染为 disabled checkbox（含未勾选）", () => {
    const html = render("- [x] 完成\n- [ ] 待办");
    expect(html).toContain('type="checkbox" disabled="" checked=""');
    expect(html).toContain('type="checkbox" disabled=""');
    expect(html).toContain("contains-task-list");
  });

  it("外部链接加 target=_blank + rel；javascript: 协议被剥除（不渲染 href 与锚点）", () => {
    const html = render("[链接](https://example.com) [坏](javascript:alert(1))");
    expect(html).toContain('<a href="https://example.com" target="_blank" rel="noopener noreferrer">');
    expect(html).not.toContain("javascript:");
    // 不安全目标整体不包锚点：只出现一个 <a>，坏链接以纯文本呈现
    expect(html.match(/<a /g)).toHaveLength(1);
    expect(html).toContain("</a> 坏</p>");
  });

  it("相对链接不渲染 href（协议白名单拒绝）", () => {
    const html = render("[本地](/docs/x)");
    expect(html).not.toContain('href="/docs/x"');
  });

  it("raw HTML 保持字面文本，不进入 DOM", () => {
    const html = render("<script>alert(1)</script>\n<div>hi</div>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<div>hi</div>");
  });

  it("图片：绝对 HTTP(S) 渲染 img；相对/其他协议渲染为 alt 文本", () => {
    const html = render("![图](https://cdn.x.com/a.png)\n![相对](/img/b.png)");
    expect(html).toContain('<img class="md-image" src="https://cdn.x.com/a.png" alt="图"/>');
    // 仅一张真实 img（React 19 SSR 会额外输出 preload link），相对路径不产生第二张
    expect(html.match(/<img /g)).toHaveLength(1);
    expect(html).not.toContain("/img/b.png");
    expect(html).toContain('<span class="md-image-alt">相对</span>');
  });

  it("mention：[@{标题}](文档id) 渲染为打开文档的胶囊（onOpenDocument 回调）", () => {
    const opened: string[] = [];
    const html = render("[@使用指南](abc-123)", (id) => opened.push(id));
    expect(html).toContain('class="mention-chip cursor-pointer"');
    expect(html).toContain('title="abc-123"');
    expect(html).toContain("@使用指南");
    // 胶囊标题截断（仅在提供 onOpenDocument 时生效）
    const long = render("[@这是一篇超长的标题](abc-123)", () => {});
    expect(long).toContain("@这是一篇…");
  });

  it("非 @ 开头的 id 链接按普通链接渲染（无 href，白名单外）", () => {
    const html = render("[标题](abc-123)");
    expect(html).not.toContain("mention-chip");
    expect(html).not.toContain('href="abc-123"');
  });

  it("行内代码与代码块围栏（语言横幅 + 复制按钮 + pre/code）", () => {
    const html = render("`inline`\n\n```ts\nconst a = 1;\n```");
    expect(html).toContain("<code>inline</code>");
    expect(html).toContain('class="md-code-block"');
    expect(html).toContain("md-code-lang");
    expect(html).toContain("ts");
    expect(html).toContain("<pre>");
    expect(html).toContain("const a = 1;");
    expect(html).toContain("复制");
  });

  it("引用块 / 分隔线 / 标题层级", () => {
    const html = render("> 引用\n\n---\n\n# H1\n\n## H2");
    expect(html).toContain("<blockquote>");
    expect(html).toContain("<hr/>");
    expect(html).toContain("<h1>H1</h1>");
    expect(html).toContain("<h2>H2</h2>");
  });

  it("行内代码为整段绝对 URL 时升级为外链（对齐 DSH）", () => {
    const html = render("访问 `https://example.com` 即可");
    expect(html).toContain('<a href="https://example.com" target="_blank" rel="noopener noreferrer">');
  });

  it("定义式引用链接（reference link）按定义解析", () => {
    const html = render("[看这里][def]\n\n[def]: https://example.com/x");
    expect(html).toContain('<a href="https://example.com/x"');
  });

  it("流式渲染与定稿渲染对已定型文本输出一致", () => {
    const text = "**加粗** 与 [链接](https://example.com)\n\n| a | b |\n| --- | --- |\n| 1 | 2 |";
    const settled = renderToStaticMarkup(createElement(MarkdownText, { text, streaming: false }));
    const streaming = renderToStaticMarkup(createElement(MarkdownText, { text, streaming: true }));
    expect(streaming).toBe(settled);
  });

  it("markdown 渲染不泄漏 mdast 结构（纯文本安全）", () => {
    const html = render("**x**");
    expect(html).not.toContain('"type"');
    expect(html).not.toContain("mdast");
  });
});
