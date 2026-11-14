// 版本历史面板：时间线 + 预览 + 一键回滚。
//
// 数据来自 docStore 契约（listVersions / getVersion / restoreVersion），
// 组件不直接 fetch —— 与项目"UI 走接缝"的约定一致。
//
// 语义（与 lib/local/db.ts 对齐）：
// - 每条版本是**改动前**的快照，所以"恢复"= 把正文/标题写回那一刻；
// - 回滚本身也是一次编辑，当前状态会先被记成一份新版本（回滚错了可以再滚回来）；
// - 写入是节流的（60s 一份、最多 50 份），时间线表达"能回到的最近状态"，不是审计日志。
import { useCallback, useEffect, useRef, useState } from "react";
import { History, Loader2, Undo } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useActor, useDocStore } from "@/src/kernel/react";
import type { DocumentVersionSummary } from "@/lib/db";
import { cn } from "@/lib/utils";

/** 相对时间（与侧边栏行的时间口径一致） */
function relativeTime(iso: string, now: number): string {
  const t = new Date(iso).getTime();
  const diff = Math.max(0, now - t);
  const m = Math.floor(diff / 60000);
  if (m < 1) return "刚刚";
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.floor(h / 24);
  if (d === 1) return "昨天";
  if (d < 7) return `${d} 天前`;
  const date = new Date(t);
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ${String(
    date.getHours(),
  ).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export interface VersionHistoryDialogProps {
  documentId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 回滚成功后回调（调用方刷新文档） */
  onRestored?: () => void;
}

export function VersionHistoryDialog({
  documentId,
  open,
  onOpenChange,
  onRestored,
}: VersionHistoryDialogProps) {
  const docStore = useDocStore();
  const actor = useActor();
  // actor 的身份只由 userId 决定；把它放进 effect 依赖会让"每次渲染都新建的
  // actor 对象"变成无限重取（useActor 在真实实现里是 memo 化的，但这里不赌它）。
  const userId = actor.userId;
  const actorRef = useRef(actor);
  actorRef.current = actor;
  const [versions, setVersions] = useState<DocumentVersionSummary[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now] = useState(() => Date.now());

  const load = useCallback(async () => {
    if (!documentId) return;
    setVersions(null);
    setError(null);
    try {
      const list = await docStore.listVersions(actorRef.current, documentId);
      setVersions(list);
      setSelectedId(list[0]?.id ?? null);
    } catch (e) {
      setVersions([]);
      setError(e instanceof Error ? e.message : "读取版本失败");
    }
    // userId 不直接出现在函数体里：它的作用是"用户换了就重新拉取"，
    // 而 actor 对象本身每次渲染都会新建，不能放进依赖。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docStore, userId, documentId]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  // 选中项变化 → 拉全文预览
  useEffect(() => {
    if (!open || !documentId || !selectedId) {
      setPreview(null);
      return;
    }
    let alive = true;
    setPreview(null);
    void docStore
      .getVersion(actorRef.current, documentId, selectedId)
      .then((v) => {
        if (alive) setPreview(v?.content ?? "");
      })
      .catch(() => {
        if (alive) setPreview("");
      });
    return () => {
      alive = false;
    };
  }, [open, documentId, selectedId, docStore, userId]);

  const onRestore = async () => {
    if (!documentId || !selectedId || pending) return;
    setPending(true);
    setError(null);
    try {
      await docStore.restoreVersion(actorRef.current, documentId, selectedId);
      onRestored?.();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "回滚失败");
    } finally {
      setPending(false);
    }
  };

  const selected = versions?.find((v) => v.id === selectedId) ?? null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lead font-semibold">
            <History className="h-4 w-4 text-shell-label-secondary" />
            版本历史
          </DialogTitle>
        </DialogHeader>

        {versions === null ? (
          <div className="flex h-48 items-center justify-center text-shell-label-secondary">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            正在读取…
          </div>
        ) : versions.length === 0 ? (
          <EmptyState
            icon={<History className="h-5 w-5" />}
            title="还没有历史版本"
            description="改一次标题或正文后，这里就会出现可回滚的快照。"
          />
        ) : (
          <div className="grid max-h-[60vh] grid-cols-[220px_1fr] gap-3 overflow-hidden">
            {/* 时间线 */}
            <ul className="min-h-0 overflow-y-auto pr-1" role="listbox" aria-label="历史版本">
              {versions.map((v) => (
                <li key={v.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={v.id === selectedId}
                    onClick={() => setSelectedId(v.id)}
                    className={cn(
                      "mb-1 flex w-full cursor-pointer flex-col items-start gap-0.5 rounded-control px-2.5 py-2 text-left transition-colors",
                      v.id === selectedId
                        ? "bg-shell-row-active-accent text-shell-label-primary"
                        : "hover:bg-shell-row-hover text-shell-label-secondary",
                    )}
                  >
                    <span className="flex w-full items-center gap-1.5">
                      <span className="min-w-0 flex-1 truncate text-ui">{v.title || "无标题"}</span>
                      {v.source === "ai" ? (
                        <span className="flex-none rounded-control bg-ai-muted px-1 text-caption text-ai-foreground">
                          AI
                        </span>
                      ) : null}
                    </span>
                    <span className="text-caption text-shell-label-tertiary">
                      {relativeTime(v.createdAt, now)} · {Math.round(v.contentLength / 100) / 10}k 字符
                    </span>
                  </button>
                </li>
              ))}
            </ul>

            {/* 预览 */}
            <div className="flex min-h-0 flex-col overflow-hidden rounded-card hairline border-shell-border">
              <div className="flex items-center justify-between gap-2 hairline-b border-shell-border px-3 py-2">
                <span className="truncate text-ui-sm text-shell-label-secondary">
                  {selected ? `${selected.title || "无标题"} 的正文快照` : "选择左侧版本预览"}
                </span>
                <Button
                  size="sm"
                  onClick={onRestore}
                  disabled={!selected || pending}
                  className="flex-none"
                >
                  {pending ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Undo className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  恢复此版本
                </Button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-3">
                {preview === null ? (
                  <span className="text-ui-sm text-shell-label-tertiary">读取中…</span>
                ) : preview.trim() === "" ? (
                  <span className="text-ui-sm text-shell-label-tertiary">（空文档）</span>
                ) : (
                  // 历史快照可能是 BlockNote JSON（旧数据是 Markdown）：
                  // 这里只做"能看到内容"的只读呈现，不做完整渲染，避免为预览再引入一条渲染管线。
                  <pre className="whitespace-pre-wrap break-words font-mono text-ui-sm leading-[1.6] text-shell-label-primary">
                    {preview.slice(0, 4000)}
                  </pre>
                )}
              </div>
            </div>
          </div>
        )}

        {error ? <p className="mt-2 text-ui-sm text-destructive">{error}</p> : null}
      </DialogContent>
    </Dialog>
  );
}
