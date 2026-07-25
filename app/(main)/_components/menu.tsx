"use client";

import { MoreHorizontal, Trash } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "../../../components/ui/dropdown-menu";
import { toast } from "sonner";
import { archive } from "@/lib/db";
import { useSupabaseUser } from "@/hooks/use-supabase-user";
import { Skeleton } from "../../../components/ui/skeleton";
import { useRouter } from "next/navigation";

interface MenuProps {
    documentId: string;
    isArchive: boolean;
}

const Menu = ({
    documentId,
    isArchive
}: MenuProps) => {
    const router = useRouter()
    const { user } = useSupabaseUser();

    if (!user) return null;

    const onArchive = () => {
        if (!documentId) {
            return;
        }

        const promise = archive(user.id, documentId)
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
                        Last edited by: {user.email}
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
