"use client"

import { useUser } from "@clerk/nextjs";
import Image from "next/image";
import { Button } from "../../../../components/ui/button";
import { PlayCircle, PlusCircle } from "lucide-react";

const DocumentsPage = () => {
  const { user } = useUser()
  console.log(user)
  
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
      <Button>
        <PlusCircle className="h-4 w-4" />
        create a note
      </Button>
    </div>
  );
}

export default DocumentsPage;