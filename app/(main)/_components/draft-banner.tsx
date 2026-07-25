"use client";

import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "../../../components/ui/button";
import { update, remove } from "@/lib/db";

interface DraftBannerProps {
  documentId: string;
}

const DraftBanner = ({ documentId }: DraftBannerProps) => {
  const router = useRouter();

  const onConfirm = () => {
    const promise = update(documentId, { isDraft: false }).then(() => {
      toast.success("草稿已保存");
    });

    toast.promise(promise, {
      loading: "保存中...",
      success: "草稿已保存",
      error: "保存失败",
    });
  };

  const onDiscard = () => {
    const promise = remove(documentId).then(() => {
      router.push("/documents");
    });

    toast.promise(promise, {
      loading: "删除中...",
      success: "草稿已丢弃",
      error: "删除失败",
    });
  };

  return (
    <div className="w-full bg-amber-500 text-center text-sm p-2 text-white flex items-center justify-center gap-x-2">
      <p>📝 AI 生成的草稿</p>
      <Button
        size="sm"
        onClick={onConfirm}
        variant="outline"
        className="border-white bg-transparent hover:bg-primary/5 cursor-pointer text-white hover:text-white p-1 px-2 h-auto font-normal"
      >
        确认保存
      </Button>
      <Button
        size="sm"
        onClick={onDiscard}
        variant="outline"
        className="border-white bg-transparent hover:bg-primary/5 text-white hover:text-white p-1 px-2 h-auto font-normal cursor-pointer"
      >
        丢弃
      </Button>
    </div>
  );
};

export default DraftBanner;
