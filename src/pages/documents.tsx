"use client";

import { useUser } from "@/hooks/use-user";
import { Button } from "@/components/ui/button";
import { FileText } from "@/components/icons";
import { useDocStore } from "@/src/kernel/react";
import { toast } from "sonner";
import { useNavigate } from "react-router";
import { useState } from "react";

const DocumentsPage = () => {

  const docStore = useDocStore();
  const { user } = useUser();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);

  if (!user) return null;

  const onCreate = () => {
    if (creating) return;
    setCreating(true);
    const promise = docStore.create({ userId: user.id }, "Untitled")
      .then((documentId) => { navigate(`/documents/${documentId}`); })
      .finally(() => setCreating(false));

    toast.promise(promise, {
      loading: "Creating a new note...",
      success: "New note created",
      error: "Failed to create a new note."
    });
  };

  return (
    <div className="flex h-full flex-col items-center justify-center px-6">
      <div className="flex h-20 w-20 items-center justify-center rounded-[20px] bg-secondary text-shell-label-tertiary shadow-[var(--shadow-sm)]">
        <FileText className="h-9 w-9" strokeWidth={1.5} />
      </div>
      <h2 className="mt-6 text-[22px] font-semibold tracking-[-0.02em]">
        欢迎回来，{user.email?.split("@")[0]}
      </h2>
      <p className="mt-2 max-w-[320px] text-center text-[13px] leading-[1.5] text-muted-foreground">
        创建你的第一篇笔记，或让 AI 助手帮你起草。
      </p>
      <Button onClick={onCreate} disabled={creating} size="lg" className="mt-6">
        <FileText className="h-4 w-4" />
        新建笔记
      </Button>
    </div>
  );
};

export default DocumentsPage;
