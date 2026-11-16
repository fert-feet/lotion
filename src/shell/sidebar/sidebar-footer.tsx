"use client";

// 侧边栏底部工具栏：工作区动作 + 账户入口。
// 高频/导航性动作保留为图标；批量操作与插件动作收进“更多”，避免底栏平铺一排等权图标。
import { Fragment, useState } from "react";
import { useNavigate } from "react-router";
import { ListChecks, MoreHorizontal, Settings, Trash } from "@/components/icons";
import { cn } from "@/lib/utils";
import { useUser } from "@/hooks/use-user";
import { useRovingToolbar } from "@/hooks/use-roving-toolbar";
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

const iconButton =
  "touch-target flex flex-none cursor-pointer items-center justify-center rounded-control bg-transparent p-0 text-shell-label-secondary transition-colors duration-150 ease-[var(--ds-ease-out)] hover:bg-shell-row-hover hover:text-shell-label-primary aria-expanded:bg-shell-row-active aria-expanded:text-shell-label-primary";

export function SidebarFooter({ rail = false, onBatchMode }: SidebarFooterProps) {
  const { user, refreshUser } = useUser();
  const navigate = useNavigate();
  const settingsOnOpen = useSettings((s) => s.onOpen);
  const [trashOpen, setTrashOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const footerActions = useSlotList(SLOT_SIDEBAR_FOOTER_ACTION);
  const orientation = rail ? "vertical" : "horizontal";
  const toolbar = useRovingToolbar(orientation);

  const displayName = user?.name || user?.email?.split("@")[0] || "Lotion 用户";
  const initial = Array.from(displayName.trim())[0]?.toUpperCase() || "L";

  const handleSignOut = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    navigate("/login");
    refreshUser();
  };

  return (
    <div
      ref={toolbar.ref}
      role="toolbar"
      aria-label="侧边栏操作"
      aria-orientation={orientation}
      onFocusCapture={toolbar.onFocusCapture}
      onKeyDown={toolbar.onKeyDown}
      {...({
        focusgroup: rail ? "toolbar wrap block" : "toolbar wrap",
      } as React.HTMLAttributes<HTMLDivElement>)}
      className={cn(
        "flex shrink-0 items-center gap-0.5",
        rail
          ? "flex-col gap-1 pb-3"
          : "mt-1 hairline-t border-shell-border px-0.5 pt-1.5",
      )}
    >
      <div
        role="group"
        aria-label="工作区"
        className={cn("flex items-center gap-0.5", rail && "flex-col gap-1")}
      >
        <button
          type="button"
          aria-label="设置"
          title="设置"
          onClick={settingsOnOpen}
          className={cn(iconButton, rail ? "size-9" : "size-7")}
        >
          <Settings className="h-4 w-4" aria-hidden="true" />
        </button>

        <Popover open={trashOpen} onOpenChange={setTrashOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="回收站"
              title="回收站"
              aria-haspopup="dialog"
              aria-expanded={trashOpen}
              className={cn(iconButton, rail ? "size-9" : "size-7")}
            >
              <Trash className="h-4 w-4" aria-hidden="true" />
            </button>
          </PopoverTrigger>
          <PopoverContent
            aria-label="回收站"
            className="w-72 max-h-[60vh] p-0"
            side={rail ? "right" : "top"}
            align={rail ? "start" : "end"}
          >
            <TrashBox />
          </PopoverContent>
        </Popover>

        <Popover open={moreOpen} onOpenChange={setMoreOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="更多侧边栏操作"
              title="更多操作"
              aria-haspopup="dialog"
              aria-expanded={moreOpen}
              className={cn(iconButton, rail ? "size-9" : "size-7")}
            >
              <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
            </button>
          </PopoverTrigger>
          <PopoverContent
            aria-label="更多侧边栏操作"
            className="w-60 p-2"
            side={rail ? "right" : "top"}
            align={rail ? "start" : "end"}
          >
            <div className="space-y-1">
              <p className="px-2 py-1 text-caption font-medium text-shell-label-tertiary">
                批量操作
              </p>
              <button
                type="button"
                onClick={() => {
                  setMoreOpen(false);
                  onBatchMode();
                }}
                className="flex min-h-8 w-full cursor-pointer items-center gap-2 rounded-control px-2 text-left text-ui text-shell-label-primary hover:bg-shell-row-hover"
              >
                <ListChecks className="h-4 w-4 text-shell-label-secondary" aria-hidden="true" />
                批量选择笔记
              </button>

              {footerActions.length > 0 && (
                <>
                  <hr className="my-1 h-px border-0 bg-shell-border" />
                  <p className="px-2 py-1 text-caption font-medium text-shell-label-tertiary">
                    插件动作
                  </p>
                  <div className="flex flex-wrap items-center gap-1 px-1">
                    {footerActions.map((action, index) => (
                      <Fragment key={index}>{action}</Fragment>
                    ))}
                  </div>
                </>
              )}
            </div>
          </PopoverContent>
        </Popover>
      </div>

      <hr
        role="separator"
        aria-orientation={rail ? "horizontal" : "vertical"}
        className={cn(
          "border-0 bg-shell-border",
          rail ? "h-px w-5" : "mx-0.5 h-4 w-px",
        )}
      />

      <div className={rail ? "mt-auto" : "ml-auto"} />

      <div role="group" aria-label="账户" className="flex min-w-0 items-center">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`账户菜单：${displayName}`}
              title={displayName}
              className={cn(
                "touch-target flex min-w-0 cursor-pointer items-center rounded-control text-shell-label-secondary transition-colors hover:bg-shell-row-hover hover:text-shell-label-primary aria-expanded:bg-shell-row-active",
                rail ? "size-9 justify-center" : "h-7 gap-1.5 px-1",
              )}
            >
              <Avatar className="h-5 w-5 shrink-0 text-caption" aria-hidden="true">
                {initial}
              </Avatar>
              {!rail && (
                <span className="hidden max-w-24 truncate text-ui-sm @min-[330px]/sidebar:block">
                  {displayName}
                </span>
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-72" align={rail ? "start" : "end"}>
            <div className="flex items-center gap-3 p-3">
              <Avatar className="h-9 w-9">{initial}</Avatar>
              <div className="min-w-0">
                <p className="truncate text-ui font-medium">{displayName}</p>
                <p className="truncate text-ui-sm text-muted-foreground">{user?.email}</p>
              </div>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={handleSignOut}
              className="w-full text-muted-foreground"
            >
              退出登录
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
