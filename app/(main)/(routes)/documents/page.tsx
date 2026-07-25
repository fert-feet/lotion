"use client";

import { useSupabaseUser } from "@/hooks/use-supabase-user";
import Image from "next/image";
import { Button } from "../../../../components/ui/button";
import { PlusCircle } from "lucide-react";
import { create } from "@/lib/db";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

const DocumentsPage = () => {
  const { user } = useSupabaseUser();
  const router = useRouter();

  if (!user) return null;

  const onCreate = () => {
    const promise = create(user.id, "Untitled")
      .then((documentId) => { router.push(`/documents/${documentId}`); });

    toast.promise(promise, {
      loading: "Creating a new note...",
      success: "New note created",
      error: "Failed to create a new note."
    });
  };

  return (
    <div className="h-full flex flex-col items-center justify-center">
      <Image
        src="/empty.png"
        width="300"
        height="300"
        alt="empty"
        className="dark:hidden"
      />
      <h2 className="text-lg font-bold mb-3">Welcome to {user.email?.split("@")[0]}&apos;s Lotion</h2>
      <Button onClick={onCreate} className="cursor-pointer">
        <PlusCircle className="h-4 w-4" />
        create a note
      </Button>
    </div>
  );
};

export default DocumentsPage;
