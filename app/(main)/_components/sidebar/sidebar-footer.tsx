"use client";

// 侧边栏底部（DSH 风格 icon 栏）：设置 / 回收站 / 批量删除 / 用户菜单。
// 28px 圆形图标按钮，hover 底色 shell-row-hover；rail 形态下 36px 竖排。
import { ListChecks, Settings, Trash } from "@/components/icons";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { useUser } from "@/hooks/use-user";
import useSettings from "@/hooks/use-setting";
import { Avatar } from "../../../../components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../../../components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "../../../../components/ui/popover";
import TrashBox from "../trash-box";

interface SidebarFooterProps {
  rail?: boolean;
  onBatchMode: () => void;
}

export function SidebarFooter({ rail, onBatchMode }: SidebarFooterProps) {
  const { user } = useUser();
  const router = useRouter();
  const settingsOnOpen = useSettings((s) => s.onOpen);
  const [trashOpen, setTrashOpen] = useState(false);

  const handleSignOut = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  };

  const displayName = user?.name || user?.email?.split("@")[0] || "Lotion 用户";
  const btn = rail ? "h-9 w-9" : "h-7 w-7";

  return (
    <div className={cn("flex shrink-0 items-center gap-0.5", rail ? "flex-col gap-1 pb-3" : "border-t border-shell-border px-1.5 py-1")}>
      <button
        type="button"
        aria-label="设置"
        title="设置"
        onClick={settingsOnOpen}
        className={cn("flex flex-none items-center justify-center rounded-full bg-transparent p-0 text-shell-label-secondary hover:bg-shell-row-hover", btn)}
      >
        <Settings className={rail ? "h-[18px] w-[18px]" : "h-4 w-4"} />
      </button>

      <Popover open={trashOpen} onOpenChange={setTrashOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="回收站"
            title="回收站"
            className={cn("flex flex-none items-center justify-center rounded-full bg-transparent p-0 text-shell-label-secondary hover:bg-shell-row-hover", btn)}
          >
            <Trash className={rail ? "h-[18px] w-[18px]" : "h-4 w-4"} />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-0" side={rail ? "right" : "top"} align={rail ? "start" : "end"}>
          <TrashBox />
        </PopoverContent>
      </Popover>

      <button
        type="button"
        aria-label="批量删除"
        title="批量删除"
        onClick={onBatchMode}
        className={cn("flex flex-none items-center justify-center rounded-full bg-transparent p-0 text-shell-label-secondary hover:bg-shell-row-hover", btn)}
      >
        <ListChecks className={rail ? "h-[18px] w-[18px]" : "h-4 w-4"} />
      </button>

      <div className={cn(rail ? "mt-auto" : "ml-auto")} />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="用户菜单"
            title={displayName}
            className={cn("flex flex-none cursor-pointer items-center justify-center rounded-full bg-transparent p-0 hover:bg-shell-row-hover", btn)}
          >
            <Avatar className="h-6 w-6 shrink-0" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-72" align="start" alignOffset={11} forceMount>
          <div className="flex items-center gap-3 p-3">
            <Avatar className="h-9 w-9" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{displayName}</p>
              <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
            </div>
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleSignOut} className="w-full cursor-pointer text-muted-foreground">
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
