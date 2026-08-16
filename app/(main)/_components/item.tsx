"use client";

import { ChevronDown, ChevronRight, LucideIcon, MoreHorizontal, Plus, Trash } from "lucide-react";
import { Skeleton } from "../../../components/ui/skeleton";
import { cn } from "../../../lib/utils";
import { useRouter } from "next/navigation";
import { memo } from "react";
import { toast } from "sonner";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "../../../components/ui/dropdown-menu";
import { useUser } from "@/hooks/use-user";
import { useRefresh } from "@/hooks/use-refresh";
import { create, archive, prefetchById } from "@/lib/db";

interface ItemProps {
    id?: string;
    documentIcon?: string;
    active?: boolean;
    expanded?: boolean;
    isSearch?: boolean;
    level?: number;
    onExpand?: () => void;
    label: string;
    onClick?: () => void;
    icon: LucideIcon;
    iconClassName?: string;
    highlighted?: boolean;
    batchMode?: boolean;
    checked?: boolean;
    onToggleCheck?: (id: string) => void;
}

const Item = memo(({
    id,
    label,
    onClick,
    icon: Icon,
    active,
    documentIcon,
    isSearch,
    level = 0,
    onExpand,
    expanded,
    iconClassName,
    highlighted,
    batchMode,
    checked,
    onToggleCheck,
}: ItemProps) => {
    const { user } = useUser();
    const triggerSidebar = useRefresh((s) => s.triggerSidebar);
    const router = useRouter();

    if (!user) return null;

    const onArchive = (
        event: React.MouseEvent<HTMLDivElement, MouseEvent>
    ) => {
        event.stopPropagation();

        if (!id) {
            return;
        }

        const promise = archive(user.id, id)
            .then(() => {
                triggerSidebar();
                router.push("/documents");
            })

        toast.promise(promise, {
            loading: "Moving to trash...",
            success: "Note moved to trash",
            error: "Failed to archive note"
        });
    };

    const onCreate = (
        event: React.MouseEvent<HTMLDivElement, MouseEvent>
    ) => {
        event.stopPropagation();

        if (!id) {
            return;
        }

        const promise = create(user.id, "Untitled", id)
            .then((documentId) => {
                if (!expanded) {
                    onExpand?.();
                }
                triggerSidebar();
                router.push(`/documents/${documentId}`);
            });

        toast.promise(promise, {
            loading: "Creating a new note...",
            success: "New note created",
            error: "Failed to create a new note."
        });
    };

    const handleExpand = (
        event: React.MouseEvent<HTMLDivElement, MouseEvent>
    ) => {
        event.stopPropagation();
        onExpand?.();
    };

    const ChevronIcon = expanded ? ChevronDown : ChevronRight;

    return (
        <div
            onClick={() => {
                if (batchMode && id) {
                    onToggleCheck?.(id);
                    return;
                }
                onClick?.();
            }}
            onMouseEnter={() => {
                if (id) {
                    prefetchById(id);
                    router.prefetch(`/documents/${id}`);
                }
            }}
            role="button"
            style={{
                paddingLeft: level ? `${(level * 14) + 14}px` : "14px"
            }}
            className={cn("group relative min-h-[32px] cursor-pointer text-sm py-1 pr-2.5 w-full hover:bg-sidebar-accent/70 flex items-center text-muted-foreground font-medium transition-colors duration-150",
                active && "bg-primary/8 text-primary before:absolute before:left-0 before:top-[6px] before:bottom-[6px] before:w-[3px] before:rounded-r-full before:bg-ai hover:bg-primary/8"
            )}
        >
            {batchMode && !!id && (
                <input
                    type="checkbox"
                    checked={!!checked}
                    onChange={(e) => {
                        e.stopPropagation();
                        onToggleCheck?.(id!);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="mr-2 h-3.5 w-3.5 shrink-0 cursor-pointer accent-foreground"
                />
            )}

            {!!id && (
                <div
                    role="button"
                    className="h-full rounded-sm hover:bg-sidebar-accent mr-1.5"
                    onClick={handleExpand}
                >
                    <ChevronIcon
                        className="h-4 w-4 shrink-0 text-muted-foreground/60"
                    />
                </div>
            )}

            {documentIcon ? (
                <div className="shrink-0 mr-2 text-[17px] leading-none">
                    {documentIcon}
                </div>
            ) : highlighted ? (
                <div className="mr-2 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-ai text-ai-foreground">
                    <Icon className="h-3 w-3" strokeWidth={2.25} />
                </div>
            ) : (
                <Icon className={cn("mr-2 h-4 w-4 shrink-0 text-muted-foreground/80", iconClassName)} strokeWidth={1.75} />
            )}
            <span className="truncate">
                {label}
            </span>
            {isSearch && (
                <kbd className="ml-auto pointer-events-none inline-flex items-center h-5 select-none gap-1 rounded-md border border-sidebar-border bg-sidebar-accent/60 px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
                    CTRL J
                </kbd>
            )}
            {!!id && (
                <div className="flex ml-auto items-center gap-x-1.5 pl-1">
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <div role="button" onClick={(e) => e.stopPropagation()} className="cursor-pointer opacity-0 group-hover:opacity-100 max-md:opacity-100 h-full rounded-md hover:bg-sidebar-accent">
                                <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
                            </div>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                            align="start"
                            className="w-60"
                            side="right"
                            forceMount
                        >
                            <DropdownMenuItem onClick={onArchive}>
                                <Trash className="h-4 w-4 mr-2" />
                                Delete
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <div className="text-xs text-muted-foreground p-2 font-medium">
                                Last edited by: {user.email}
                            </div>
                        </DropdownMenuContent>
                    </DropdownMenu>

                    <div role="button" onClick={onCreate} className="opacity-0 group-hover:opacity-100 max-md:opacity-100 h-full rounded-md hover:bg-sidebar-accent">
                        <Plus className="h-4 w-4 text-muted-foreground" />
                    </div>
                </div>
            )}
        </div>
    );
});

Item.displayName = "Item";

const ItemSkeleton = function ItemSkeleton({ level }: { level?: number; }) {
    return (
        <div
            style={{
                paddingLeft: level ? `${(level * 14) + 25}px` : "14px"
            }}
            className="flex gap-x-2 py-[3px]"
        >
            <Skeleton className="h-4 w-4" />
            <Skeleton className="h-4 w-[30%]" />
        </div>
    );
};

const ItemWithSkeleton = Object.assign(Item, { Skeleton: ItemSkeleton });
export default ItemWithSkeleton;
