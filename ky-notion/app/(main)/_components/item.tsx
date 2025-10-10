"use client";

import { ChevronDown, ChevronRight, LucideIcon, Plus } from "lucide-react";
import { Id } from "../../../convex/_generated/dataModel";
import { Skeleton } from "../../../components/ui/skeleton";
import { cn } from "../../../lib/utils";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

interface ItemProps {
    id?: Id<"documents">;
    documentIcon?: string;
    active?: boolean;
    expanded?: boolean;
    isSearch?: boolean;
    level?: number;
    onExpand?: () => void;
    label: string;
    onClick: () => void;
    icon: LucideIcon;
}
const Item = ({
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
}: ItemProps) => {
    const router = useRouter();
    const create = useMutation(api.documents.create);

    const onCreate = (
        event: React.MouseEvent<HTMLDivElement, MouseEvent>
    ) => {
        event.stopPropagation(); // 外面还包着一个button，点击当前 button 不会引发外层 button

        if (!id) {
            return;
        }

        const promise = create({ parentDocument: id, title: "Untitled" })
            .then((documentId) => {
                if (!expanded) {
                    onExpand?.();
                }
                //    router.push(`/documents/${documentId}`) 
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
        event.stopPropagation(); // 外面还包着一个button，点击当前 button 不会引发外层 button
        onExpand?.();
    };

    const ChevronIcon = expanded ? ChevronDown : ChevronRight;


    return (
        <div
            onClick={onClick}
            role="button"
            style={{
                paddingLeft: level ? `${(level * 12) + 12}px` : "12px"
            }}
            className={cn("group min-h[27px] cursor-pointer text-sm py-1 pr-3 w-full hover:bg-primary/5 flex items-center text-muted-foreground font-medium",
                active && "bg-primary/5 text-primary"
            )}
        >
            {/*!!id 判断 id 是否存在（boolean）id 存在 则 !!id = true  */}
            {!!id && (
                <div
                    role="button"
                    className="h-full rounded-sm hover:bg-neutral-300 dark:bg-neutral-600 mr-1"
                    onClick={handleExpand}
                >

                    <ChevronIcon
                        className="h-4 w-4 shrink-0 text-muted-foreground/65"
                    />

                </div>
            )}

            {documentIcon ? (
                <div>
                    {documentIcon}
                </div>
            ) : (
                <Icon className="mr-2 h-[18px] text-muted-foreground shrink-0" />
            )}
            <span className="truncate">
                {label}
            </span>
            {isSearch && (
                <kbd className="ml-auto pointer-events-none inline-flex items-center h-5 select-none gap-1 rounded border bg-muted px-1.5 font-mono text-[11px] font-medium text-muted-foreground opacity-100 ">
                    <span className="text-xs">CTRL</span>K
                </kbd>
            )}
            {!!id && (
                <div className="flex ml-auto items-center gap-x-2">
                    <div role="button" onClick={onCreate} className="opacity-0 group-hover:opacity-100 h-full ml-auto rounded-sm hover:bg-neutral-300 dark:hover:bg-neutral-600">
                        <Plus className="h-4 w-4 text-muted-foreground" />
                    </div>
                </div>
            )}
        </div>
    );
};

Item.Skeleton = function ItemSkeleton({ level }: { level?: number; }) {
    return (
        <div
            style={{
                paddingLeft: level ? `${(level * 12) + 25}px` : "12px"
            }}
            className="flex gap-x-2 py-[3px]"
        >
            <Skeleton className="h-4 w-4" />
            <Skeleton className="h-4 w-[30%]" />
        </div>
    );
};

export default Item;