"use client";

import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "../../../components/ui/button";
import { useRefresh } from "@/hooks/use-refresh";
import { update, remove } from "@/lib/db";
import { FileText, Trash2 } from "lucide-react";

interface DraftBannerProps {
  documentId: string;
}

const DraftBanner = ({ documentId }: DraftBannerProps) => {
  const router = useRouter();
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
      router.push("/documents");
    });

    toast.promise(promise, {
      loading: "删除中...",
      success: "草稿已丢弃",
      error: "删除失败",
    });
  };

  return (
    <div className="w-full border-b bg-muted border-border">
      <div className="max-w-3xl lg:max-w-4xl mx-auto flex items-center gap-3 px-4 py-2.5">
        <FileText className="h-4 w-4 text-foreground shrink-0" />
        <p className="text-sm font-medium text-foreground flex-1">
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
