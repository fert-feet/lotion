"use client";

// 自研建议菜单（斜杠菜单 / @提及共用）：对标 Notion 的列表式浮层。
// 通过 SuggestionMenuController 的 suggestionMenuComponent prop 注入，
// 完全绕开依赖 ComponentsContext 的包内默认菜单组件（裸 BlockNoteViewRaw 不提供该 context）。
import { Fragment } from "react";
import type { DefaultReactSuggestionItem, SuggestionMenuProps } from "@blocknote/react";

export default function LotionSuggestionMenu({
  items,
  loadingState,
  selectedIndex,
  onItemClick,
}: SuggestionMenuProps<DefaultReactSuggestionItem>) {
  if (loadingState === "loading-initial" || loadingState === "loading") {
    return <div className="lotion-suggestion-menu lotion-suggestion-menu--loading">加载中…</div>;
  }

  let lastGroup: string | undefined;
  return (
    <div className="lotion-suggestion-menu" role="listbox">
      {items.map((item, index) => {
        const showLabel = item.group !== lastGroup;
        lastGroup = item.group;
        return (
          <Fragment key={`${item.title}-${index}`}>
            {showLabel && item.group && (
              <div className="lotion-suggestion-menu-label">{item.group}</div>
            )}
            <button
              type="button"
              role="option"
              aria-selected={selectedIndex === index}
              className={
                selectedIndex === index
                  ? "lotion-suggestion-menu-item is-selected"
                  : "lotion-suggestion-menu-item"
              }
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onItemClick?.(item)}
            >
              {item.icon && <span className="lotion-suggestion-menu-icon">{item.icon}</span>}
              <span className="lotion-suggestion-menu-title">{item.title}</span>
              {item.subtext && (
                <span className="lotion-suggestion-menu-subtext">{item.subtext}</span>
              )}
              {item.badge && <kbd className="lotion-suggestion-menu-badge">{item.badge}</kbd>}
            </button>
          </Fragment>
        );
      })}
    </div>
  );
}
