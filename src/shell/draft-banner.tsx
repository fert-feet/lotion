"use client";

import { toast } from "sonner";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { useRefresh } from "@/hooks/use-refresh";
import { update, remove } from "@/lib/db";
import { FileText, Trash2 } from "@/components/icons";

interface DraftBannerProps {
  documentId: string;
}

const DraftBanner = ({ documentId }: DraftBannerProps) => {
  const navigate = useNavigate();
  const triggerSidebar = useRefresh((s) => s.triggerSidebar);
  const triggerDocument = useRefresh((s) => s.triggerDocument);

  const onConfirm = () => {
    const promise = update(documentId, { isDraft: false }).then(() => {
      triggerSidebar();
      triggerDocument(documentId);
    });

    toast.promise(promise, {
      loading: "保存中...",
      success: "草稿已保存",
      error: "保存失败",
    });
  };

  const onDiscard = () => {
    const promise = remove(documentId).then(() => {
      triggerSidebar();
      navigate("/documents");
    });

    toast.promise(promise, {
      loading: "删除中...",
      success: "草稿已丢弃",
      error: "删除失败",
    });
  };

  return (
    <div className="w-full border-b-[0.5px] border-shell-border bg-secondary">
      <div className="mx-auto flex max-w-3xl items-center gap-2.5 px-4 py-2 lg:max-w-4xl">
        <FileText className="h-4 w-4 text-foreground shrink-0" />
        <p className="flex-1 text-[13px] font-medium text-foreground">
          AI 生成的草稿
        </p>
        <Button
          size="sm"
          variant="outline"
          onClick={onConfirm}
          className="h-7 text-xs"
        >
          确认保存
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={onDiscard}
          className="h-7 text-xs text-muted-foreground hover:text-destructive"
        >
          <Trash2 className="h-3.5 w-3.5 mr-1" />
          丢弃
        </Button>
      </div>
    </div>
  );
};

export default DraftBanner;
