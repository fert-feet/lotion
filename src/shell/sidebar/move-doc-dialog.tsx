"use client";

import { useEffect, useMemo, useState } from "react";
import type { SidebarDocument } from "@/lib/seams/doc-store";
import { Search } from "@/components/icons";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { docBreadcrumb, movableDocTargets } from "./doc-tree-model";

interface MoveDocDialogProps {
  docs: SidebarDocument[];
  documentId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMove: (id: string, parentDocument: string | null) => void;
}

export function MoveDocDialog({
  docs,
  documentId,
  open,
  onOpenChange,
  onMove,
}: MoveDocDialogProps) {
  const source = documentId ? docs.find((doc) => doc.id === documentId) : undefined;
  const [selectedParent, setSelectedParent] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) return;
    setSelectedParent(source?.parentDocument ?? null);
    setQuery("");
  }, [open, source?.parentDocument]);

  const targets = useMemo(() => {
    if (!source) return [];
    return movableDocTargets(docs, source.id, query);
  }, [docs, query, source]);

  if (!source) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>移动「{source.title || "无标题"}」</DialogTitle>
          <DialogDescription>
            选择新的上级页面。不能移动到自身或其子页面下。
          </DialogDescription>
        </DialogHeader>

        <label className="mb-2 flex h-8 items-center gap-2 rounded-control hairline border-shell-border-l2 bg-secondary px-2.5">
          <Search className="h-3.5 w-3.5 flex-none text-shell-label-tertiary" />
          <span className="sr-only">筛选目标页面</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="筛选目标页面"
            className="min-w-0 flex-1 bg-transparent text-ui text-shell-label-primary outline-none placeholder:text-shell-label-placeholder"
          />
        </label>

        <div
          role="radiogroup"
          aria-label="移动目标"
          className="max-h-[min(55vh,360px)] space-y-1 overflow-y-auto rounded-card hairline border-shell-border p-1.5"
        >
          {query.trim() === "" && (
            <button
              type="button"
              role="radio"
              aria-checked={selectedParent === null}
              onClick={() => setSelectedParent(null)}
              className={cn(
                "flex min-h-9 w-full cursor-pointer items-center rounded-control px-2.5 text-left text-ui",
                selectedParent === null
                  ? "bg-shell-row-active-accent text-shell-label-primary"
                  : "text-shell-label-secondary hover:bg-shell-row-hover",
              )}
            >
              根目录
            </button>
          )}

          {targets.map((target) => {
            const path = docBreadcrumb(docs, target.id);
            return (
              <button
                key={target.id}
                type="button"
                role="radio"
                aria-checked={selectedParent === target.id}
                onClick={() => setSelectedParent(target.id)}
                className={cn(
                  "flex min-h-10 w-full cursor-pointer items-center rounded-control px-2.5 py-1 text-left",
                  selectedParent === target.id
                    ? "bg-shell-row-active-accent text-shell-label-primary"
                    : "hover:bg-shell-row-hover",
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 text-ui">
                    {target.icon && <span aria-hidden="true">{target.icon}</span>}
                    <span className="truncate">{target.title || "无标题"}</span>
                  </span>
                  {path.length > 0 && (
                    <span className="block truncate text-caption leading-4 text-shell-label-tertiary">
                      {path.join(" / ")}
                    </span>
                  )}
                </span>
              </button>
            );
          })}

          {targets.length === 0 && query.trim() !== "" && (
            <p className="px-3 py-6 text-center text-ui-sm text-shell-label-tertiary">
              没有匹配的目标页面
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            disabled={selectedParent === (source.parentDocument ?? null)}
            onClick={() => {
              onMove(source.id, selectedParent);
              onOpenChange(false);
            }}
          >
            移动
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
