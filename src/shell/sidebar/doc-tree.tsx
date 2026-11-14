"use client";

// 文档树 + 行（移植 DSH WorkspaceBrowser/rows 设计）：
// 行高 32px、radius 8、缩进步进 22px；hover 时时间让位于操作按钮（+ 子笔记 / ... 菜单）；
// 选中整行底色（shell-row-active）。批量删除模式下行内出现复选框。
import { useNavigate, useParams } from "react-router";
import { memo, useEffect, useMemo, useState } from "react";
import { ChevronRight, FileIcon, MoreHorizontal, Plus, Trash } from "@/components/icons";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useUser } from "@/hooks/use-user";
import { useRefresh } from "@/hooks/use-refresh";
import type { SidebarDocument } from "@/lib/seams/doc-store";
import { useActor, useDocStore } from "@/src/kernel/react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** 相对时间（DSH 紧凑格式） */
function relativeTime(iso: string | null, now: number): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  const diff = Math.max(0, now - t);
  const m = Math.floor(diff / 60000);
  if (m < 1) return "刚刚";
  if (m < 60) return m + "分钟前";
  const h = Math.floor(m / 60);
  if (h < 24) return h + "小时前";
  const d = Math.floor(h / 24);
  if (d === 1) return "昨天";
  if (d < 7) return d + "天前";
  const date = new Date(t);
  return date.getFullYear() + "/" + (date.getMonth() + 1) + "/" + date.getDate();
}
interface DocRowProps {
  doc: SidebarDocument;
  active: boolean;
  level: number;
  expanded: boolean;
  hasChildren: boolean;
  onExpand: () => void;
  onOpen: () => void;
  onCreateChild: () => void;
  onArchive: () => void;
  batchMode: boolean;
  checked: boolean;
  onToggleCheck: (id: string) => void;
}

const DocRow = memo(function DocRow({
  doc,
  active,
  level,
  expanded,
  hasChildren,
  onExpand,
  onOpen,
  onCreateChild,
  onArchive,
  batchMode,
  checked,
  onToggleCheck,
}: DocRowProps) {
  const docStore = useDocStore();
  const actor = useActor();
  // SSR 水合安全：首渲 now=0（统一"刚刚"，服务端/客户端一致），挂载后取真实时间
  const [now, setNow] = useState(0);
  useEffect(() => { setNow(Date.now()); }, []);

  return (
    <div
      role="treeitem"
      // 行内还有「＋子笔记 / ⋯菜单」两个真按钮，因此本行不能用 <button>（不能嵌套按钮）。
      // 用 tabIndex=0 + 键盘处理让它可达：此前是 role="button" tabIndex={-1}，
      // 等于把文档树从键盘/读屏用户手里整个拿走。
      tabIndex={0}
      aria-level={level + 1}
      aria-selected={active}
      aria-expanded={hasChildren ? expanded : undefined}
      onClick={() => {
        if (batchMode) { onToggleCheck(doc.id); return; }
        onOpen();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          if (batchMode) { onToggleCheck(doc.id); return; }
          onOpen();
        } else if (e.key === "ArrowRight" && hasChildren && !expanded) {
          e.preventDefault();
          onExpand();
        } else if (e.key === "ArrowLeft" && hasChildren && expanded) {
          e.preventDefault();
          onExpand();
        }
      }}
      onMouseEnter={() => { docStore.prefetch?.(actor, doc.id); }}
      style={{ paddingLeft: level * 22 + 4 }}
      className={cn(
        // h-8 = 32px（注释与设计稿一直是 32px，类名此前误写成 h-7）
        "group relative flex h-8 cursor-pointer select-none items-center gap-1.5 rounded-control px-1.5 text-ui leading-5 text-shell-label-primary animate-[row-in_150ms_ease]",
        "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-shell-accent",
        active ? "bg-shell-row-active-accent font-medium" : "hover:bg-shell-row-hover"
      )}
    >
      {batchMode && (
        <input
          type="checkbox"
          checked={checked}
          onChange={() => onToggleCheck(doc.id)}
          onClick={(e) => e.stopPropagation()}
          className="h-3.5 w-3.5 shrink-0 cursor-pointer accent-shell-accent"
        />
      )}

      <span className="flex h-5 w-4 flex-none items-center justify-center text-shell-label-tertiary">
        {hasChildren ? (
          <ChevronRight
            onClick={(e: React.MouseEvent) => { e.stopPropagation(); onExpand(); }}
            className={cn("h-4 w-4 transition-transform duration-150 ease-[var(--ds-ease-in-out)]", expanded && "rotate-90")}
          />
        ) : null}
      </span>

      <span className="flex h-5 w-4 flex-none items-center justify-center">
        {doc.icon ? (
          <span className="text-lead leading-none">{doc.icon}</span>
        ) : (
          <FileIcon className="h-4 w-4 text-shell-label-tertiary" strokeWidth={1.75} />
        )}
      </span>

      {/* 尾部固定占位 52px：时间戳与操作按钮叠在同一位，只做透明度切换。
          此前用互斥的 hover 显隐类互相顶替（一个 display:none、另一个 display:flex），悬停时标题右边界
          会被挤动约 44px——侧边栏是鼠标最频繁的区域，这会被误读成「选错行」。 */}
      <span className="min-w-0 flex-1 truncate pr-[52px] text-ui leading-5">{doc.title || "无标题"}</span>

      <span className="absolute inset-y-0 right-1.5 flex w-[52px] items-center justify-end">
        <span className="pointer-events-none absolute inset-0 flex items-center justify-end text-caption leading-5 text-shell-label-tertiary transition-opacity duration-150 group-hover:opacity-0">
          {relativeTime(doc.updatedAt, now)}
        </span>

        <span className="relative flex items-center gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
        <button
          type="button"
          aria-label="新建子笔记"
          title="新建子笔记"
          onClick={(e) => { e.stopPropagation(); onCreateChild(); }}
          className="flex h-5 w-5 cursor-pointer items-center justify-center rounded-control bg-transparent p-0 text-shell-label-tertiary hover:bg-shell-row-active hover:text-shell-label-primary"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="更多操作"
              onClick={(e) => e.stopPropagation()}
              className="flex h-5 w-5 cursor-pointer items-center justify-center rounded-control bg-transparent p-0 text-shell-label-tertiary hover:bg-shell-row-active hover:text-shell-label-primary"
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="right" forceMount className="w-52">
            <DropdownMenuItem onClick={onArchive} className="cursor-pointer">
              <Trash className="mr-2 h-4 w-4" />
              移入回收站
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        </span>
      </span>
    </div>
  );
});
interface DocTreeProps {
  docs: SidebarDocument[];
  level?: number;
  parentDocumentId?: string | null;
  batchMode?: boolean;
  selected?: Set<string>;
  onToggleCheck?: (id: string) => void;
  expanded?: Record<string, boolean>;
  onExpandChange?: (id: string) => void;
}

export function DocTree({
  docs,
  level = 0,
  parentDocumentId = null,
  batchMode,
  selected,
  onToggleCheck,
  expanded,
  onExpandChange,
}: DocTreeProps) {
  const docStore = useDocStore();
  const params = useParams();
  const navigate = useNavigate();
  const { user } = useUser();
  const triggerSidebar = useRefresh((s) => s.triggerSidebar);

  const children = useMemo(() =>
    docs.filter((d) => (parentDocumentId ? d.parentDocument === parentDocumentId : d.parentDocument == null)),
    [docs, parentDocumentId],
  );

  if (children.length === 0) return null;

  return (
    <>
      {children.map((doc) => {
        const isExpanded = !!expanded?.[doc.id];
        const hasChildren = docs.some((d) => d.parentDocument === doc.id);
        const onOpen = () => navigate("/documents/" + doc.id);
        const onExpand = () => onExpandChange?.(doc.id);
        const onCreateChild = () => {
          if (!user) return;
          const promise = docStore.create({ userId: user.id }, "Untitled", doc.id).then((documentId) => {
            if (!isExpanded) onExpandChange?.(doc.id);
            triggerSidebar();
            navigate("/documents/" + documentId);
          });
          toast.promise(promise, {
            loading: "Creating a new note...",
            success: "New note created",
            error: "Failed to create a new note.",
          });
        };
        const onArchive = () => {
          if (!user) return;
          const promise = docStore.archive({ userId: user.id }, doc.id).then(() => {
            triggerSidebar();
            if (params.documentId === doc.id) navigate("/documents");
          });
          toast.promise(promise, {
            loading: "Moving to trash...",
            success: "Note moved to trash",
            error: "Failed to archive note",
          });
        };
        return (
          <div key={doc.id}>
            <DocRow
              doc={doc}
              active={params.documentId === doc.id}
              level={level}
              expanded={isExpanded}
              hasChildren={hasChildren}
              onExpand={onExpand}
              onOpen={onOpen}
              onCreateChild={onCreateChild}
              onArchive={onArchive}
              batchMode={!!batchMode}
              checked={!!selected?.has(doc.id)}
              onToggleCheck={onToggleCheck || (() => {})}
            />
            {isExpanded && hasChildren && (
              <DocTree
                docs={docs}
                level={level + 1}
                parentDocumentId={doc.id}
                batchMode={batchMode}
                selected={selected}
                onToggleCheck={onToggleCheck}
                expanded={expanded}
                onExpandChange={onExpandChange}
              />
            )}
          </div>
        );
      })}
    </>
  );
}
/** 扁平搜索结果（搜索时替代树）。 */
export function DocSearchResults({ docs, query }: {
  docs: SidebarDocument[];
  query: string;
}) {
  const navigate = useNavigate();
  const params = useParams();
  const q = query.trim().toLowerCase();
  const hits = docs.filter((d) => d.title.toLowerCase().includes(q));
  if (hits.length === 0) {
    return <div className="px-3 py-2.5 text-ui leading-[18px] text-shell-label-tertiary">没有匹配的笔记</div>;
  }
  return (
    <div className="flex flex-col gap-0.5">
      {hits.map((doc) => (
        <div
          key={doc.id}
          role="button"
          onClick={() => { navigate("/documents/" + doc.id); }}
          className={cn(
            "flex h-8 cursor-pointer select-none items-center gap-1.5 rounded-card px-2 text-shell-label-primary",
            params.documentId === doc.id ? "bg-shell-row-active" : "hover:bg-shell-row-hover"
          )}
        >
          <span className="flex h-5 w-4 flex-none items-center justify-center">
            {doc.icon ? <span className="text-lead leading-none">{doc.icon}</span> : <FileIcon className="h-4 w-4 text-shell-label-tertiary" strokeWidth={1.75} />}
          </span>
          <span className="min-w-0 flex-1 truncate text-sm leading-5">{doc.title || "无标题"}</span>
        </div>
      ))}
    </div>
  );
}