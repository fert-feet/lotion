"use client";

import { MoreHorizontal, Trash } from "@/components/icons";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { useDocStore } from "@/src/kernel/react";
import { useRefresh } from "@/hooks/use-refresh";
import { useUser } from "@/hooks/use-user";
import { Skeleton } from "@/components/ui/skeleton";
import { useNavigate } from "react-router";

interface MenuProps {
    documentId: string;
    isArchive: boolean;
}

const Menu = ({
    documentId,
    isArchive
}: MenuProps) => {
    const docStore = useDocStore();
    const navigate = useNavigate();
    const { user } = useUser();
    const triggerSidebar = useRefresh((s) => s.triggerSidebar);

    if (!user) return null;

    const onArchive = () => {
        if (!documentId) {
            return;
        }

        const promise = docStore.archive({ userId: user.id }, documentId)
            .then(() => {
                triggerSidebar();
                navigate("/documents");
            })

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
                    <div role="button" onClick={(e) => e.stopPropagation()} className="cursor-pointer h-full ml-auto rounded-sm hover:bg-secondary">
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
