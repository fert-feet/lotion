// @vitest-environment jsdom
// LotionSuggestionMenu 渲染单测：分组标签、图标/标题/快捷键、选中态高亮。
import { describe, expect, it } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { DefaultReactSuggestionItem } from "@blocknote/react";
import LotionSuggestionMenu from "@/components/editor/lotion-suggestion-menu";

const ITEMS: DefaultReactSuggestionItem[] = [
  { title: "Callout", subtext: "提示框", group: "基础", icon: <span>💡</span>, onItemClick: () => {} },
  { title: "Heading 1", badge: "⌘⌥1", group: "基础", onItemClick: () => {} },
  { title: "Image", group: "媒体", onItemClick: () => {} },
];

function renderMenu(props: Partial<Parameters<typeof LotionSuggestionMenu>[0]> = {}) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  act(() => {
    root.render(
      <LotionSuggestionMenu
        items={ITEMS}
        loadingState="loaded"
        selectedIndex={undefined}
        onItemClick={() => {}}
        {...props}
      />,
    );
  });
  return el;
}

describe("LotionSuggestionMenu", () => {
  it("渲染分组标签、标题、图标与快捷键徽标", () => {
    const el = renderMenu();
    const text = el.textContent ?? "";
    expect(text).toContain("基础");
    expect(text).toContain("媒体");
    expect(text).toContain("Callout");
    expect(text).toContain("提示框");
    expect(text).toContain("💡");
    expect(text).toContain("⌘⌥1");
    expect(el.querySelectorAll(".lotion-suggestion-menu-label").length).toBe(2);
    expect(el.querySelectorAll(".lotion-suggestion-menu-item").length).toBe(3);
  });

  it("selectedIndex 对应项带 is-selected 类", () => {
    const el = renderMenu({ selectedIndex: 1 });
    const items = el.querySelectorAll<HTMLButtonElement>(".lotion-suggestion-menu-item");
    expect(items[1].className).toContain("is-selected");
    expect(items[0].className).not.toContain("is-selected");
  });

  it("加载态显示提示文案", () => {
    const el = renderMenu({ loadingState: "loading" });
    expect(el.textContent).toContain("加载中");
  });
});
