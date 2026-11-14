// @vitest-environment jsdom
// EmptyState：把三套手搓空状态收成一个组件（图标/字号/按钮尺寸此前各页都不一样）。
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { EmptyState } from "@/components/ui/empty-state";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(node: React.ReactElement) {
  act(() => root.render(node));
}

describe("EmptyState", () => {
  it("page 形态：图标 + 标题 + 说明 + 主操作，尺寸全走 token", () => {
    render(
      <EmptyState
        icon="📄"
        title="还没有笔记"
        description="创建第一篇"
        action={<button type="button">新建</button>}
      />,
    );
    expect(container.querySelector("h2")?.textContent).toBe("还没有笔记");
    expect(container.textContent).toContain("创建第一篇");
    expect(container.querySelector("button")?.textContent).toBe("新建");
    // 图标容器必须是 44px 卡片刻度（此前各页是 64/48/56 三种）
    const tile = container.querySelector(".rounded-card");
    expect(tile?.className).toContain("h-11");
    expect(tile?.className).toContain("w-11");
    // 标题用字级 token，不许出现 text-[Npx]
    expect(container.innerHTML).not.toMatch(/text-\[\d+px\]/);
    expect(container.querySelector("h2")?.className).toContain("text-lead");
  });

  it("不传 icon / description / action 时不渲染空标签", () => {
    render(<EmptyState title="空的" />);
    expect(container.querySelector("h2")?.textContent).toBe("空的");
    expect(container.querySelector(".rounded-card")).toBeNull();
    expect(container.querySelector("p")).toBeNull();
    expect(container.querySelector("button")).toBeNull();
  });

  it("inline 形态：一行虚线框提示，不渲染标题/图标", () => {
    render(<EmptyState variant="inline" title="没有匹配的插件。" />);
    expect(container.textContent).toBe("没有匹配的插件。");
    expect(container.querySelector("h2")).toBeNull();
    expect(container.querySelector("p")?.className).toContain("border-dashed");
    // 虚线框用发丝线工具类，不再写 border-[0.5px]
    expect(container.querySelector("p")?.className).toContain("hairline");
  });
});
