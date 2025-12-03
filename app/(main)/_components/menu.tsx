"use client";

import { MoreHorizontal, Trash } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "../../../components/ui/dropdown-menu";
import { Id } from "../../../convex/_generated/dataModel";
import { toast } from "sonner";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useUser } from "@clerk/nextjs";
import { Skeleton } from "../../../components/ui/skeleton";
import { useRouter } from "next/navigation";

interface MenuProps {
    documentId: Id<"documents">;
    isArchive: boolean;
}

const Menu = ({
    documentId,
    isArchive
}: MenuProps) => {
    const archive = useMutation(api.documents.archive);
    const router = useRouter()

    const { user } = useUser();

    const onArchive = (
    ) => {
        if (!documentId) {
            return;
        }

        const promise = archive({ id: documentId })
            .then(() => router.push("/documents"))

        toast.promise(promise, {
            loading: "Moving to trash...",
            success: "Note moved to trash",
            error: "Failed to archive note"
        });
    };

    return (
        <div>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <div role="button" onClick={(e) => e.stopPropagation()} className="cursor-pointer h-full ml-auto rounded-sm hover:bg-neutral-300 dark:hover:bg-neutral-600">
                        <MoreHorizontal className="h-4 w-4" />
                    </div>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                    align="start"
                    className="w-60"
                    side="right"
                    forceMount
                >
                    <DropdownMenuItem onClick={onArchive} disabled={isArchive} className="cursor-pointer">
                        <Trash className="h-4 w-4 mr-2" />
                        Delete
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <div className="text-xs text-muted-foreground p-2 font-medium">
                        Last edited by: {user?.username}
                    </div>
                </DropdownMenuContent>
            </DropdownMenu>
        </div>
    );
};

Menu.Skeleton = function MenuSkeleton() {
    return (
        <Skeleton className="mt-1 h-4 w-5 rounded-sm" />
    );
};

export default Menu;