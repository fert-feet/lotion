"use client";

// 侧边栏底部（DSH 风格 icon 栏）：设置 / 回收站 / 批量删除 / 用户菜单。
// 28px 圆形图标按钮，hover 底色 shell-row-hover；rail 形态下 36px 竖排。
import { ListChecks, MoreHorizontal, Settings, Trash } from "@/components/icons";
import { useNavigate } from "react-router";
import { Fragment, useState } from "react";
import { cn } from "@/lib/utils";
import { useUser } from "@/hooks/use-user";
import { useCoarsePointer } from "@/hooks/use-coarse-pointer";
import { useSlotList } from "@/src/kernel/react";
import useSettings from "@/hooks/use-setting";
import { Avatar } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SLOT_SIDEBAR_FOOTER_ACTION } from "../ui-plugins";
import TrashBox from "../trash-box";

interface SidebarFooterProps {
  rail?: boolean;
  onBatchMode: () => void;
}

export function SidebarFooter({ rail, onBatchMode }: SidebarFooterProps) {
  const { user, refreshUser } = useUser();
  const coarsePointer = useCoarsePointer();
  const navigate = useNavigate();
  const settingsOnOpen = useSettings((s) => s.onOpen);
  const [trashOpen, setTrashOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  // 第三方客户端插件贡献的底部动作（list 槽；无贡献时为空数组）
  const footerActions = useSlotList(SLOT_SIDEBAR_FOOTER_ACTION);
  const inlineLimit = coarsePointer ? 0 : 2;
  const inlineActions = footerActions.slice(0, inlineLimit);
  const overflowActions = footerActions.slice(inlineLimit);

  const handleSignOut = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    navigate("/login");
    refreshUser();
  };

  const displayName = user?.name || user?.email?.split("@")[0] || "Lotion 用户";
  const btn = rail ? "h-9 w-9" : "h-7 w-7";

  return (
    <div className={cn("flex shrink-0 items-center gap-0.5 @max-[300px]/sidebar:gap-0", rail ? "flex-col gap-1 pb-3" : "mt-1 hairline-t border-shell-border px-0.5 pt-1.5")}>
      <button
        type="button"
        aria-label="设置"
        title="设置"
        onClick={settingsOnOpen}
        className={cn("touch-target flex flex-none items-center justify-center rounded-control bg-transparent p-0 text-shell-label-secondary hover:bg-shell-row-hover", btn)}
      >
        <Settings className="h-4 w-4" />
      </button>

      <Popover open={trashOpen} onOpenChange={setTrashOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="回收站"
            title="回收站"
            className={cn("touch-target flex flex-none items-center justify-center rounded-control bg-transparent p-0 text-shell-label-secondary hover:bg-shell-row-hover", btn)}
          >
            <Trash className="h-4 w-4" />
          </button>
        </PopoverTrigger>
        {/* max-h 限制浮层高度：TrashBox 内部按 flex 布局让列表区独立滚动 */}
        <PopoverContent
          aria-label="回收站"
          className="w-72 max-h-[60vh] p-0"
          side={rail ? "right" : "top"}
          align={rail ? "start" : "end"}
        >
          <TrashBox />
        </PopoverContent>
      </Popover>

      <button
        type="button"
        aria-label="批量删除"
        title="批量删除"
        onClick={onBatchMode}
        className={cn("touch-target flex flex-none items-center justify-center rounded-control bg-transparent p-0 text-shell-label-secondary hover:bg-shell-row-hover", btn)}
      >
        <ListChecks className="h-4 w-4" />
      </button>

      {inlineActions.map((action, index) => (
        <Fragment key={index}>{action}</Fragment>
      ))}

      {overflowActions.length > 0 && (
        <Popover open={moreOpen} onOpenChange={setMoreOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="更多侧边栏动作"
              title="更多动作"
              className={cn("touch-target flex flex-none items-center justify-center rounded-control bg-transparent p-0 text-shell-label-secondary hover:bg-shell-row-hover", btn)}
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </PopoverTrigger>
          <PopoverContent
            aria-label="更多侧边栏动作"
            className="w-56 p-2"
            side={rail ? "right" : "top"}
            align={rail ? "start" : "end"}
          >
            <div className="flex flex-wrap items-center gap-1">
              {overflowActions}
            </div>
          </PopoverContent>
        </Popover>
      )}

      <div className={cn(rail ? "mt-auto" : "ml-auto")} />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="用户菜单"
            title={displayName}
            className={cn("touch-target flex flex-none cursor-pointer items-center justify-center rounded-control bg-transparent p-0 hover:bg-shell-row-hover", btn)}
          >
            <Avatar className="h-6 w-6 shrink-0" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-72" align="start" alignOffset={11}>
          <div className="flex items-center gap-3 p-3">
            <Avatar className="h-9 w-9" />
            <div className="min-w-0">
              <p className="truncate text-ui font-medium">{displayName}</p>
              <p className="truncate text-ui-sm text-muted-foreground">{user?.email}</p>
            </div>
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleSignOut} className="w-full cursor-pointer text-muted-foreground">
            退出登录
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
