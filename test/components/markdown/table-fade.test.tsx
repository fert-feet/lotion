// @vitest-environment jsdom
// 表格横滚提示的接线测试：溢出方向决定 data-fade，CSS 再据此做渐隐遮罩。
// 背景：mac 默认隐藏滚动条，三列表在 docked 面板里必然溢出——不给提示就是内容被裁。
import { describe, it, expect, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MarkdownText } from "@/components/markdown/MarkdownText";

const TABLE = "| 项 | 说明 | 备注 |\n| --- | --- | --- |\n| a | 很长的一段说明 | 第三列 |";

let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
});

/** 渲染表格并把滚动容器的尺寸改成可塑（jsdom 里 scrollWidth/clientWidth 恒为 0） */
async function mountTable() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(createElement(MarkdownText, { text: TABLE, streaming: false })));
  return container.querySelector(".md-table-scroll") as HTMLDivElement;
}

/** 设定可滚动几何并触发一次 scroll 事件（组件在 scroll 上重算方向） */
async function scrollTo(element: HTMLDivElement, scrollLeft: number, scrollWidth: number, clientWidth: number) {
  Object.defineProperty(element, "scrollWidth", { value: scrollWidth, configurable: true });
  Object.defineProperty(element, "clientWidth", { value: clientWidth, configurable: true });
  Object.defineProperty(element, "scrollLeft", { value: scrollLeft, configurable: true });
  await act(async () => {
    element.dispatchEvent(new Event("scroll"));
  });
}

describe("表格横向滚动提示", () => {
  it("不溢出时 data-fade=none（没有可滚内容就不该出现渐隐）", async () => {
    const element = await mountTable();
    await scrollTo(element, 0, 240, 240);
    expect(element.getAttribute("data-fade")).toBe("none");
  });

  it("停在最左：只有右侧还能滚 → data-fade=end", async () => {
    const element = await mountTable();
    await scrollTo(element, 0, 420, 240);
    expect(element.getAttribute("data-fade")).toBe("end");
  });

  it("滚到中间：两侧都能滚 → data-fade=both", async () => {
    const element = await mountTable();
    await scrollTo(element, 60, 420, 240);
    expect(element.getAttribute("data-fade")).toBe("both");
  });

  it("滚到最右：只有左侧还能滚 → data-fade=start", async () => {
    const element = await mountTable();
    await scrollTo(element, 180, 420, 240);
    expect(element.getAttribute("data-fade")).toBe("start");
  });
});
