"use client";

// 文档图标选择器：内置精简表情集 + 关键词搜索。
//
// 之前用 emoji-picker-react（打开一次要下 ~680 KB：组件本体 261 KB + native 数据集 419 KB）。
// 笔记里给文档挑图标的用例只需要"常用 + 搜得到"，内置 180 个带中文关键词的表情即可，
// 代价是 0 个额外 chunk（数据就在主包里，几 KB）。
import { useMemo, useState } from "react";
import { Search } from "@/components/icons";
import { EMOJI_GROUPS, searchEmojis } from "./emoji-data";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { cn } from "@/lib/utils";

interface IconPickerProps {
  onChange: (icon: string) => void;
  children: React.ReactNode;
  asChild?: boolean;
}

const IconPicker = ({ onChange, children }: IconPickerProps) => {
  const [query, setQuery] = useState("");
  const [activeGroup, setActiveGroup] = useState<string>(EMOJI_GROUPS[0]?.id ?? "doc");

  const visible = useMemo(() => {
    if (query.trim()) return searchEmojis(query);
    return EMOJI_GROUPS.find((g) => g.id === activeGroup)?.emojis.map(([e]) => e) ?? [];
  }, [query, activeGroup]);

  return (
    <Popover>
      <PopoverTrigger>{children}</PopoverTrigger>
      <PopoverContent className="w-72 p-0">
        <div className="flex items-center gap-1.5 hairline-b border-shell-border px-2 py-1.5">
          <Search className="h-3.5 w-3.5 flex-none text-shell-label-tertiary" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索表情（如 想法 / 完成）"
            aria-label="搜索表情"
            className="h-6 w-full min-w-0 bg-transparent text-ui text-shell-label-primary outline-none placeholder:text-shell-label-tertiary"
          />
        </div>

        {query.trim() === "" && (
          <div className="flex flex-wrap gap-0.5 px-1.5 py-1.5">
            {EMOJI_GROUPS.map((group) => (
              <button
                key={group.id}
                type="button"
                onClick={() => setActiveGroup(group.id)}
                aria-pressed={group.id === activeGroup}
                className={cn(
                  "cursor-pointer rounded-control px-1.5 py-1 text-ui-sm transition-colors",
                  group.id === activeGroup
                    ? "bg-shell-row-active text-shell-label-primary"
                    : "text-shell-label-secondary hover:bg-shell-row-hover",
                )}
              >
                {group.label}
              </button>
            ))}
          </div>
        )}

        <div
          className="grid max-h-56 grid-cols-8 gap-0.5 overflow-y-auto p-1.5"
          role="listbox"
          aria-label="表情"
        >
          {visible.length === 0 ? (
            <p className="col-span-8 py-6 text-center text-ui-sm text-shell-label-tertiary">
              没有匹配的表情
            </p>
          ) : (
            visible.map((emoji) => (
              <button
                key={emoji}
                type="button"
                role="option"
                aria-selected={false}
                aria-label={emoji}
                onClick={() => onChange(emoji)}
                className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-control text-lead leading-none transition-colors hover:bg-shell-row-hover"
              >
                {emoji}
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default IconPicker;
