"use client";

import { useUser } from "@clerk/nextjs";
import Image from "next/image";
import { Button } from "../../../../components/ui/button";
import { PlusCircle } from "lucide-react";
import { useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

const DocumentsPage = () => {
  const { user } = useUser();
  const create = useMutation(api.documents.create);
  const router = useRouter();

  const onCreate = () => {
    const promise = create({ title: "Untitled" })
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
      <h2 className="text-lg font-bold mb-3">Welcome to {user?.username}&apos;s Lotion</h2>
      <Button onClick={onCreate} className="cursor-pointer">
        <PlusCircle className="h-4 w-4" />
        create a note
      </Button>
    </div>
  );
};

export default DocumentsPage;