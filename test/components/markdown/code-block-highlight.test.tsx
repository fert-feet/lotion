// @vitest-environment jsdom
// 代码块高亮的接线测试：首帧先出原文，异步 token 到达后换成带高亮的 span。
// （高亮算法本身在 test/lib/markdown-highlight.test.ts 里单独钉住）
import { describe, it, expect, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { CodeBlock } from "@/components/markdown/CodeBlock";

let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
});

/** 渲染组件并等待 predicate 成立（高亮是异步的） */
async function renderAndWait(
  element: ReturnType<typeof createElement>,
  predicate: (node: ParentNode) => boolean,
): Promise<HTMLDivElement> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(element));
  const deadline = Date.now() + 3000;
  while (!predicate(container)) {
    if (Date.now() > deadline) throw new Error("等待高亮超时");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
  return container;
}

describe("CodeBlock 高亮接线", () => {
  it("高亮到达后 data-highlighted 变 true，token 带双主题变量", async () => {
    const node = await renderAndWait(
      createElement(CodeBlock, { code: "const a = 1;\n", lang: "ts" }),
      (el) => el.querySelector(".md-code-block")?.getAttribute("data-highlighted") === "true",
    );

    const spans = [...node.querySelectorAll("pre span")] as HTMLElement[];
    expect(spans.length).toBeGreaterThan(0);
    expect(spans.some((span) => span.style.getPropertyValue("--shiki-light") !== "")).toBe(true);
    expect(spans.some((span) => span.style.getPropertyValue("--shiki-dark") !== "")).toBe(true);
    // 不能写内联 color：否则 .dark 的换色规则会输给内联样式
    expect(spans.every((span) => span.style.color === "")).toBe(true);
    // 复制依赖 textContent，拼回必须仍是完整源码
    expect(node.querySelector("pre")?.textContent).toBe("const a = 1;");
  });

  it("语言不认识时保持纯文本（data-highlighted=false，内容不丢）", async () => {
    const node = await renderAndWait(
      createElement(CodeBlock, { code: "hello\n", lang: "brainfuck" }),
      (el) => el.querySelector(".md-code-block") !== null,
    );
    // 给异步臂一点时间确认它不会把纯文本换掉
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    const block = node.querySelector(".md-code-block")!;
    expect(block.getAttribute("data-highlighted")).toBe("false");
    expect(node.querySelector("pre")?.textContent).toBe("hello");
    expect(node.querySelectorAll("pre span")).toHaveLength(0);
  });

  it("没有语言标识（流式期间）不触发高亮", async () => {
    const node = await renderAndWait(
      createElement(CodeBlock, { code: "const a = 1;\n" }),
      (el) => el.querySelector(".md-code-block") !== null,
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(node.querySelector(".md-code-block")!.getAttribute("data-highlighted")).toBe("false");
  });
});
