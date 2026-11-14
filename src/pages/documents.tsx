"use client";

import { useUser } from "@/hooks/use-user";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
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
      <EmptyState
        icon={<FileText className="h-5 w-5" strokeWidth={1.5} />}
        title={`欢迎回来，${user.email?.split("@")[0]}`}
        action={
          <Button onClick={onCreate} disabled={creating} size="lg">
            <FileText className="h-4 w-4" />
            新建笔记
          </Button>
        }
      />
    </div>
  );
};

export default DocumentsPage;
