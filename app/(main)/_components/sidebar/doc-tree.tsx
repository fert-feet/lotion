"use client";

// 文档树 + 行（移植 DSH WorkspaceBrowser/rows 设计）：
// 行高 32px、radius 8、缩进步进 22px；hover 时时间让位于操作按钮（+ 子笔记 / ... 菜单）；
// 选中整行底色（shell-row-active）。批量删除模式下行内出现复选框。
import { useParams, useRouter } from "next/navigation";
import { memo, useEffect, useMemo, useState } from "react";
import { ChevronRight, FileIcon, MoreHorizontal, Plus, Trash } from "@/components/icons";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useUser } from "@/hooks/use-user";
import { useRefresh } from "@/hooks/use-refresh";
import { archive, create, prefetchById, type SidebarDocument } from "@/lib/db";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../../../components/ui/dropdown-menu";

/** 相对时间（DSH 紧凑格式） */
function relativeTime(iso: string | null, now: number): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  const diff = Math.max(0, now - t);
  const m = Math.floor(diff / 60000);
  if (m < 1) return "刚刚";
  if (m < 60) return m + " 分钟前";
  const h = Math.floor(m / 60);
  if (h < 24) return h + " 小时前";
  const d = Math.floor(h / 24);
  if (d < 7) return d + " 天前";
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
  // SSR 水合安全：首渲 now=0（统一"刚刚"，服务端/客户端一致），挂载后取真实时间
  const [now, setNow] = useState(0);
  useEffect(() => { setNow(Date.now()); }, []);

  return (
    <div
      role="button"
      tabIndex={-1}
      onClick={() => {
        if (batchMode) { onToggleCheck(doc.id); return; }
        onOpen();
      }}
      onMouseEnter={() => { prefetchById(doc.id); }}
      style={{ paddingLeft: level * 22 + 8 }}
      className={cn(
        "group relative flex h-8 cursor-pointer select-none items-center gap-1.5 rounded-lg px-2 text-shell-label-primary animate-[row-in_150ms_ease]",
        active ? "bg-shell-row-active" : "hover:bg-shell-row-hover"
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
          <span className="text-[15px] leading-none">{doc.icon}</span>
        ) : (
          <FileIcon className="h-4 w-4 text-shell-label-tertiary" strokeWidth={1.75} />
        )}
      </span>

      <span className="min-w-0 flex-1 truncate text-sm leading-5">{doc.title || "无标题"}</span>

      <span className="flex-none text-xs leading-5 text-shell-label-tertiary group-hover:hidden">
        {relativeTime(doc.updatedAt, now)}
      </span>

      <span className="hidden flex-none items-center gap-3 group-hover:flex">
        <button
          type="button"
          aria-label="新建子笔记"
          title="新建子笔记"
          onClick={(e) => { e.stopPropagation(); onCreateChild(); }}
          className="flex h-4 w-4 cursor-pointer items-center justify-center rounded bg-transparent p-0 text-shell-label-tertiary hover:text-shell-label-primary"
        >
          <Plus className="h-4 w-4" />
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="更多操作"
              onClick={(e) => e.stopPropagation()}
              className="flex h-4 w-4 cursor-pointer items-center justify-center rounded bg-transparent p-0 text-shell-label-tertiary hover:text-shell-label-primary"
            >
              <MoreHorizontal className="h-4 w-4" />
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
  const params = useParams();
  const router = useRouter();
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
        const onOpen = () => router.push("/documents/" + doc.id);
        const onExpand = () => onExpandChange?.(doc.id);
        const onCreateChild = () => {
          if (!user) return;
          const promise = create(user.id, "Untitled", doc.id).then((documentId) => {
            if (!isExpanded) onExpandChange?.(doc.id);
            triggerSidebar();
            router.push("/documents/" + documentId);
          });
          toast.promise(promise, {
            loading: "Creating a new note...",
            success: "New note created",
            error: "Failed to create a new note.",
          });
        };
        const onArchive = () => {
          if (!user) return;
          const promise = archive(user.id, doc.id).then(() => {
            triggerSidebar();
            if (params.documentId === doc.id) router.push("/documents");
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
  const router = useRouter();
  const params = useParams();
  const q = query.trim().toLowerCase();
  const hits = docs.filter((d) => d.title.toLowerCase().includes(q));
  if (hits.length === 0) {
    return <div className="px-3 py-2.5 text-[13px] leading-[18px] text-shell-label-tertiary">没有匹配的笔记</div>;
  }
  return (
    <div className="flex flex-col gap-0.5">
      {hits.map((doc) => (
        <div
          key={doc.id}
          role="button"
          onClick={() => { router.push("/documents/" + doc.id); }}
          className={cn(
            "flex h-8 cursor-pointer select-none items-center gap-1.5 rounded-lg px-2 text-shell-label-primary",
            params.documentId === doc.id ? "bg-shell-row-active" : "hover:bg-shell-row-hover"
          )}
        >
          <span className="flex h-5 w-4 flex-none items-center justify-center">
            {doc.icon ? <span className="text-[15px] leading-none">{doc.icon}</span> : <FileIcon className="h-4 w-4 text-shell-label-tertiary" strokeWidth={1.75} />}
          </span>
          <span className="min-w-0 flex-1 truncate text-sm leading-5">{doc.title || "无标题"}</span>
        </div>
      ))}
    </div>
  );
}