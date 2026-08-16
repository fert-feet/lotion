"use client";

import { useUser } from "@/hooks/use-user";
import { Button } from "../../../../components/ui/button";
import { FileText, Sparkles } from "@/components/icons";
import { create } from "@/lib/db";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { useState } from "react";

const DocumentsPage = () => {
  const { user } = useUser();
  const router = useRouter();
  const [creating, setCreating] = useState(false);

  if (!user) return null;

  const onCreate = () => {
    if (creating) return;
    setCreating(true);
    const promise = create(user.id, "Untitled")
      .then((documentId) => { router.push(`/documents/${documentId}`); })
      .finally(() => setCreating(false));

    toast.promise(promise, {
      loading: "Creating a new note...",
      success: "New note created",
      error: "Failed to create a new note."
    });
  };

  return (
    <div className="h-full flex flex-col items-center justify-center px-6">
      <div className="graph-paper relative flex h-44 w-64 items-center justify-center rounded-xl border border-border bg-card shadow-md shadow-ink/5">
        {/* 荧光笔划痕：签名元素 */}
        <div className="absolute left-4 right-4 top-1/2 h-[10px] -rotate-1 rounded-sm bg-ai/70" />
        <div className="absolute left-8 right-8 top-1/2 mt-5 h-[6px] rotate-1 rounded-sm bg-ai/35" />
        <FileText className="relative h-10 w-10 text-foreground" strokeWidth={1.5} />
      </div>
      <h2 className="mt-8 font-display text-2xl font-semibold tracking-tight">
        欢迎回来，{user.email?.split("@")[0]}
      </h2>
      <p className="mt-2 text-sm text-muted-foreground text-center max-w-sm leading-relaxed">
        创建你的第一篇笔记，或打开 AI 助手让它帮你写。
        <Sparkles className="inline h-3.5 w-3.5 text-ai -mt-0.5 ml-1" />
      </p>
      <Button onClick={onCreate} disabled={creating} className="mt-6 cursor-pointer bg-ai text-ai-foreground hover:bg-ai/90 shadow-md shadow-ai/20">
        <FileText className="h-4 w-4" />
        Create a note
      </Button>
    </div>
  );
};

export default DocumentsPage;
