"use client";

// 自研全局搜索命令面板（Cmd/Ctrl+J）：
// 替代原 cmdk 方案——Dialog 遮罩 + 输入框过滤文档列表 + 键盘 ↑↓/Enter/Esc。
import { useUser } from "@/hooks/use-user";
import { useNavigate } from "react-router";
import { useEffect, useRef, useState } from "react";
import useSearch from "@/hooks/use-search";
import { getSearch, type SidebarDocument } from "@/lib/db";
import { File, Search } from "@/components/icons";
import { Dialog, DialogContent } from "./ui/dialog";
import { cn } from "@/lib/utils";

const SearchCommand = () => {
  const { user } = useUser();
  const navigate = useNavigate();
  const [documents, setDocuments] = useState<SidebarDocument[]>([]);
  const [isMounted, setIsMounted] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const isOpen = useSearch((s) => s.isOpen);
  const onClose = useSearch((s) => s.onClose);
  const toggle = useSearch((s) => s.toggle);

  useEffect(() => { setIsMounted(true); }, []);

  useEffect(() => {
    if (isOpen && user) {
      // alive 标志：快速开合搜索框时丢弃过期结果
      let alive = true;
      getSearch(user.id)
        .then((data) => { if (alive) setDocuments(data); })
        .catch(() => { if (alive) setDocuments([]); });
      setQuery("");
      setHighlight(0);
      setTimeout(() => inputRef.current?.focus(), 30);
      return () => { alive = false; };
    }
  }, [isOpen, user]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "j" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        toggle();
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, [toggle]);

  const q = query.trim().toLowerCase();
  const filtered = documents.filter((d) => d.title.toLowerCase().includes(q));

  const onSelect = (id: string) => {
    navigate("/documents/" + id);
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setHighlight((i) => Math.min(i + 1, Math.max(0, filtered.length - 1))); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHighlight((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") { const hit = filtered[Math.min(highlight, filtered.length - 1)]; if (hit) onSelect(hit.id); }
  };

  if (!isMounted) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent showCloseButton={false} className="max-w-lg overflow-hidden p-0">
        {/* 搜索输入行 */}
        <div className="flex items-center gap-2.5 border-b border-shell-border-l2 px-4">
          <Search className="h-4 w-4 shrink-0 text-shell-label-tertiary" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setHighlight(0); }}
            onKeyDown={onKeyDown}
            placeholder={"搜索 " + (user?.email?.split("@")[0] || "你的") + " 的笔记…"}
            className="h-12 min-w-0 flex-1 border-none bg-transparent text-sm text-shell-label-primary outline-none placeholder:text-shell-label-caption"
          />
        </div>
        {/* 结果列表 */}
        <div className="max-h-80 overflow-y-auto p-1.5">
          {filtered.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-shell-label-tertiary">没有匹配的笔记</div>
          ) : (
            <div className="flex flex-col gap-0.5">
              <div className="px-2.5 py-1 text-xs font-medium text-shell-label-tertiary">文档</div>
              {filtered.map((doc, i) => (
                <button
                  key={doc.id}
                  type="button"
                  onClick={() => onSelect(doc.id)}
                  onMouseEnter={() => setHighlight(i)}
                  className={cn(
                    "flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-shell-label-primary",
                    i === highlight ? "bg-shell-row-active" : "hover:bg-shell-row-hover"
                  )}
                >
                  {doc.icon ? <span className="text-[18px] leading-none">{doc.icon}</span> : <File className="h-4 w-4 shrink-0 text-shell-label-tertiary" />}
                  <span className="min-w-0 truncate">{doc.title}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default SearchCommand;
