"use client";

import { LucideIcon } from "lucide-react";
import { Id } from "../../../convex/_generated/dataModel";

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
    return (
        <div
            onClick={onClick}
            role="button"
            style={{ paddingLeft: "12px" }}
            className="group min-h[27px] cursor-pointer text-sm py-1 pr-3 w-full hover:bg-primary/5 flex items-center text-muted-foreground font-medium"
        >
            <Icon className="mr-2 h-[18px] text-muted-foreground shrink-0" />
            <span className="truncate">
                {label}
            </span>
            {isSearch && (
                <kbd className="ml-auto pointer-events-none inline-flex items-center h-5 select-none gap-1 rounded border bg-muted px-1.5 font-mono text-[11px] font-medium text-muted-foreground opacity-100 ">
                    <span className="text-xs">CTRL</span>K
                </kbd>
            )}
        </div>
    );
};

// todo skeloton

export default Item;