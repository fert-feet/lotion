"use client";

// 自研全局搜索命令面板（⌘K / Ctrl+K）：
// 替代原 cmdk 方案——Dialog 遮罩 + 输入框过滤文档列表 + 键盘 ↑↓/Enter/Esc。
import { useUser } from "@/hooks/use-user";
import { useNavigate } from "react-router";
import { useEffect, useRef, useState } from "react";
import useSearch from "@/hooks/use-search";
import type { SidebarDocument } from "@/lib/seams/doc-store";
import { useDocStore } from "@/src/kernel/react";
import { File, Search } from "@/components/icons";
import { Dialog, DialogContent, DialogTitle } from "./ui/dialog";
import { cn } from "@/lib/utils";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function HighlightedText({ text, query }: { text: string; query: string }) {
  const q = query.trim();
  if (!q) return <>{text}</>;
  const parts = text.split(new RegExp(`(${escapeRegExp(q)})`, "gi"));
  return (
    <>
      {parts.map((part, index) =>
        part.toLocaleLowerCase() === q.toLocaleLowerCase() ? (
          <mark key={index} className="rounded-control bg-ai-muted px-0.5 text-inherit">
            {part}
          </mark>
        ) : (
          <span key={index}>{part}</span>
        ),
      )}
    </>
  );
}

function documentPath(doc: SidebarDocument, all: SidebarDocument[]): string {
  const byId = new Map(all.map((item) => [item.id, item]));
  const labels: string[] = [];
  const seen = new Set<string>();
  let parent = doc.parentDocument;
  while (parent && !seen.has(parent)) {
    seen.add(parent);
    const item = byId.get(parent);
    if (!item) break;
    labels.unshift(item.title || "未命名");
    parent = item.parentDocument;
  }
  return labels.join(" / ");
}

const SearchCommand = () => {

  const docStore = useDocStore();
  const { user } = useUser();
  const navigate = useNavigate();
  const [documents, setDocuments] = useState<SidebarDocument[]>([]);
  // 服务端全文检索结果：输入停顿 200ms 才发请求（FTS5 走索引，但没必要每个键都打一次）
  const [remote, setRemote] = useState<SidebarDocument[] | null>(null);
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
      docStore.listSearch({ userId: user.id })
        .then((data) => { if (alive) setDocuments(data); })
        .catch(() => { if (alive) setDocuments([]); });
      setQuery("");
      setRemote(null);
      setHighlight(0);
      setTimeout(() => inputRef.current?.focus(), 30);
      return () => { alive = false; };
    }
  }, [isOpen, user, docStore]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        toggle();
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, [toggle]);

  // 全文检索：≥2 个字符时问服务端（标题/正文都能命中），同时保留本地标题过滤作为兜底
  useEffect(() => {
    const q = query.trim();
    if (!isOpen || !user || q.length < 2) {
      setRemote(null);
      return;
    }
    let alive = true;
    const timer = setTimeout(() => {
      docStore
        .listSearch({ userId: user.id }, q)
        .then((data) => {
          if (alive) setRemote(data);
        })
        .catch(() => {
          if (alive) setRemote(null); // 检索失败退回本地过滤，不让面板空掉
        });
    }, 200);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [query, isOpen, user, docStore]);

  const q = query.trim().toLowerCase();
  // 服务端结果优先（含正文命中）；未返回时先用本地标题过滤，避免输入瞬间闪空
  const localFiltered = documents.filter((d) => d.title.toLowerCase().includes(q));
  const filtered = remote && q.length >= 2 ? remote : localFiltered;

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
      <DialogContent showCloseButton={false} className="max-w-[560px] overflow-hidden rounded-panel p-0">
        {/* 视觉上隐藏的标题：DialogContent 用 aria-labelledby 指向它，
            否则读屏软件只会念一个没有名字的「对话框」。 */}
        <DialogTitle className="sr-only">搜索笔记</DialogTitle>
        {/* 搜索输入行 */}
        <div className="flex items-center gap-2.5 hairline-b border-shell-border px-3.5">
          <Search className="h-[18px] w-[18px] shrink-0 text-shell-label-tertiary" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setHighlight(0); }}
            onKeyDown={onKeyDown}
            aria-label="搜索笔记"
            aria-autocomplete="list"
            aria-controls="global-search-results"
            aria-activedescendant={
              filtered.length > 0 ? `global-search-result-${filtered[Math.min(highlight, filtered.length - 1)]?.id}` : undefined
            }
            placeholder={"搜索 " + (user?.email?.split("@")[0] || "你的") + " 的笔记…"}
            className="h-12 min-w-0 flex-1 border-none bg-transparent text-lead text-shell-label-primary outline-none placeholder:text-shell-label-caption"
          />
        </div>
        {/* 结果列表 */}
        <div className="max-h-[360px] overflow-y-auto p-1.5">
          {filtered.length === 0 ? (
            <div className="px-3 py-6 text-center text-ui text-shell-label-tertiary">没有匹配的笔记</div>
          ) : (
            <div
              id="global-search-results"
              role="listbox"
              aria-label="搜索结果"
              className="flex flex-col gap-0.5"
            >
              <div className="px-2.5 py-1 text-caption font-semibold text-shell-label-tertiary">文档</div>
              {filtered.map((doc, i) => (
                <button
                  key={doc.id}
                  id={`global-search-result-${doc.id}`}
                  type="button"
                  role="option"
                  aria-selected={i === highlight}
                  onClick={() => onSelect(doc.id)}
                  onMouseEnter={() => setHighlight(i)}
                  className={cn(
                    "flex w-full cursor-pointer items-start gap-2.5 rounded-control px-2 py-1.5 text-left text-ui text-shell-label-primary focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-shell-accent",
                    i === highlight ? "bg-shell-row-active" : "hover:bg-shell-row-hover"
                  )}
                >
                  {doc.icon ? (
                    <span className="text-body leading-none">{doc.icon}</span>
                  ) : (
                    <File className="mt-0.5 h-4 w-4 shrink-0 text-shell-label-tertiary" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">
                      <HighlightedText text={doc.title || "未命名"} query={q} />
                    </span>
                    {doc.snippet ? (
                      <span className="mt-0.5 line-clamp-2 block text-ui-sm leading-[18px] text-shell-label-tertiary">
                        <HighlightedText text={doc.snippet} query={q} />
                      </span>
                    ) : null}
                    {documentPath(doc, documents) ? (
                      <span className="mt-0.5 block truncate text-caption text-shell-label-caption">
                        {documentPath(doc, documents)}
                      </span>
                    ) : null}
                  </span>
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
