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
            loading: "正在移入回收站...",
            success: "已移入回收站",
            error: "移入回收站失败"
        });
    };

    return (
        <div>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <button
                        type="button"
                        aria-label="更多操作"
                        onClick={(e) => e.stopPropagation()}
                        className="ml-auto flex h-full w-7 cursor-pointer items-center justify-center rounded-control bg-transparent p-0 text-shell-label-secondary hover:bg-secondary hover:text-shell-label-primary"
                    >
                        <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                    </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                    align="start"
                    className="w-60"
                    side="right"
                    forceMount
                >
                    <DropdownMenuItem onClick={onArchive} disabled={isArchive} className="cursor-pointer">
                        <Trash className="h-4 w-4 mr-2" />
                        删除
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <div className="text-ui-sm text-muted-foreground p-2 font-medium">
                        最后编辑：{user.email}
                    </div>
                </DropdownMenuContent>
            </DropdownMenu>
        </div>
    );
};

Menu.Skeleton = function MenuSkeleton() {
    return (
        <Skeleton className="mt-1 h-4 w-5 rounded-control" />
    );
};

export default Menu;
