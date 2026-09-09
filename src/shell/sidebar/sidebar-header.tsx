"use client";

// 侧边栏头部 —— macOS 语言：
// 13px 半粗小标题 + 填充式搜索框（放大镜内置、无边框）+ 24px 图标按钮。
// expanded 由父级控制（rail 的搜索按钮点击后展开侧边栏并强制展开搜索框）。
import { useEffect, useRef } from "react";
import { Plus, Search, Sparkles, X } from "@/components/icons";
import { useLayout } from "@/hooks/use-layout";
import { cn } from "@/lib/utils";

interface SidebarHeaderProps {
  query: string;
  onQueryChange: (q: string) => void;
  expanded: boolean;
  onExpandedChange: (open: boolean) => void;
  onCreate: () => void;
  label: string;
}

/** 图标按钮：24px 圆形，hover 出现填充底（Apple 的 toolbar button） */
const iconBtn =
  "flex h-6 w-6 flex-none cursor-pointer items-center justify-center rounded-[6px] bg-transparent p-0 text-shell-label-secondary transition-colors duration-150 hover:bg-shell-row-hover hover:text-shell-label-primary";

export function SidebarHeader({ query, onQueryChange, expanded, onExpandedChange, onCreate, label }: SidebarHeaderProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const detailsOpen = useLayout((s) => s.details > 0);
  const toggleDetails = useLayout((s) => s.toggleDetails);

  useEffect(() => {
    if (expanded) inputRef.current?.focus({ preventScroll: true });
  }, [expanded]);

  useEffect(() => {
    if (!expanded) return;
    const onClick = (event: MouseEvent) => {
      if (event.target instanceof Node && inputRef.current?.closest("[data-sidebar-search]")?.contains(event.target)) return;
      if (query !== "") return;
      onExpandedChange(false);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [expanded, query, onExpandedChange]);

  const collapse = () => {
    onExpandedChange(false);
    onQueryChange("");
  };

  return (
    <div className="mb-2 flex h-7 shrink-0 items-center justify-end gap-1 px-0.5">
      {/* 标题：搜索展开时折叠让位 */}
      <span
        className={cn(
          "min-w-0 max-w-[45%] flex-none overflow-hidden text-ellipsis whitespace-nowrap text-[13px] font-semibold leading-5 tracking-[-0.01em] text-shell-label-primary transition-all duration-200 ease-[var(--ds-ease-in-out)]",
          expanded && "max-w-0 -mr-1 translate-x-[-4px] opacity-0"
        )}
      >
        {label}
      </span>

      {/* 搜索框：Apple 的填充式搜索（放大镜内置） */}
      <div className={cn("flex min-w-0 flex-1 items-center transition-all duration-200 ease-[var(--ds-ease-in-out)]", expanded ? "max-w-full" : "max-w-6")}>
        <div
          data-sidebar-search
          onClick={() => onExpandedChange(true)}
          className={cn(
            "flex h-6 w-full cursor-text items-center overflow-hidden rounded-[6px] bg-transparent text-shell-label-secondary transition-all duration-200 ease-[var(--ds-ease-in-out)]",
            expanded && "h-7 rounded-[6px] bg-secondary text-shell-label-tertiary"
          )}
        >
          <button
            type="button"
            aria-label="搜索笔记"
            title="搜索笔记（Cmd/Ctrl+J）"
            onClick={(e) => {
              e.stopPropagation();
              if (!expanded) { onExpandedChange(true); inputRef.current?.focus(); }
            }}
            className={cn(iconBtn, expanded && "ml-0.5")}
          >
            <Search className="h-3.5 w-3.5" />
          </button>
          <input
            ref={inputRef}
            type="text"
            value={query}
            placeholder="搜索"
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") collapse();
            }}
            className={cn(
              "w-0 min-w-0 flex-1 border-none bg-transparent pr-1 text-[13px] leading-[18px] text-shell-label-primary opacity-0 outline-none transition-opacity duration-100 placeholder:text-shell-label-tertiary",
              expanded && "opacity-100"
            )}
            tabIndex={expanded ? 0 : -1}
          />
          {expanded && (
            <button
              type="button"
              aria-label="清除搜索"
              onClick={(e) => {
                e.stopPropagation();
                collapse();
              }}
              className={cn(iconBtn, "mr-0.5 h-5 w-5")}
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      {/* 操作按钮：AI 助手 + 新建；搜索展开时让位隐藏 */}
      <div className={cn("flex flex-none items-center gap-0.5 transition-all duration-200 ease-[var(--ds-ease-in-out)]", expanded && "max-w-0 translate-x-1 opacity-0")}>
        <button
          type="button"
          aria-label="AI 助手"
          title="AI 助手"
          onClick={toggleDetails}
          className={cn(iconBtn, detailsOpen && "bg-ai text-ai-foreground hover:bg-ai hover:text-ai-foreground")}
        >
          <Sparkles className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          aria-label="新建笔记"
          title="新建笔记"
          onClick={onCreate}
          className={iconBtn}
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
