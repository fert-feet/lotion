"use client";

import { ChevronsLeft, ListChecks, MenuIcon, PenLine, Plus, Search, Settings, Sparkles, Trash } from "lucide-react";
import { useParams, usePathname, useRouter } from "next/navigation";
import React, { ElementRef, useEffect, useRef, useState } from "react";
import { useMediaQuery } from "usehooks-ts";
import { cn } from "../../../lib/utils";
import UserItem from "./user-item";
import { create, remove } from "@/lib/db";
import { useSupabaseUser } from "@/hooks/use-supabase-user";
import { useRefresh } from "@/hooks/use-refresh";
import Item from "./item";
import { toast } from "sonner";
import DocumentList from "./document-list";
import { Popover, PopoverContent, PopoverTrigger } from "../../../components/ui/popover";
import TrashBox from "./trash-box";
import useSearch from "../../../hooks/use-search";
import useSettings from "../../../hooks/use-setting";
import { useAiPanel } from "@/hooks/use-ai-panel";
import ConfirmModal from "../../../components/modals/confirm-modal";
import { Button } from "../../../components/ui/button";
import Navbar from "./navbar";

const Navigation = () => {
    const pathName = usePathname();
    const params = useParams();
    const isMobile = useMediaQuery("(max-width: 768px)");
    const { user } = useSupabaseUser();
    const toggle = useSearch((store) => store.toggle);
    // 只订阅用到的 action：整 store 订阅会在任何字段变化时重渲染 Navigation
    const settingsOnOpen = useSettings((s) => s.onOpen);
    const aiPanelToggle = useAiPanel((s) => s.toggle);
    const triggerSidebar = useRefresh((s) => s.triggerSidebar);
    const router = useRouter();

    const isResizingRef = useRef(false);
    // 拖拽是否发生过移动：拖拽结束后 mouseup 会派发 click，若移动过则抑制 resetWidth，
    // 否则刚拖出的宽度会被立即复位
    const dragMoved = useRef(false);
    const sidebarRef = useRef<ElementRef<"aside">>(null);
    const navbarRef = useRef<ElementRef<"div">>(null);

    const [isResetting, setIsResetting] = useState(false);
    const [isCollapsed, setIsCollapsed] = useState(isMobile);
    // 批量删除模式：进入后文档行出现复选框，底部操作条确认后永久删除
    const [batchMode, setBatchMode] = useState(false);
    const [selected, setSelected] = useState<Set<string>>(new Set());

    useEffect(() => {
        if (isMobile) {
            collapse();
        } else {
            resetWidth();
        }
    }, [isMobile, pathName]);

    const onCreate = () => {
        if (!user) return;
        const promise = create(user.id, "Untitled")
            .then((documentId) => {
                triggerSidebar();
                router.push(`/documents/${documentId}`);
            });

        toast.promise(promise, {
            loading: "Creating a new note...",
            success: "New note created",
            error: "Failed to create a new note."
        });
    };

    const toggleCheck = (id: string) => {
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const exitBatchMode = () => {
        setSelected(new Set());
        setBatchMode(false);
    };

    const batchDelete = () => {
        if (selected.size === 0) return;
        const ids = Array.from(selected);
        const promise = Promise.all(ids.map((id) => remove(id))).then(() => {
            triggerSidebar();
            exitBatchMode();
        });
        toast.promise(promise, {
            loading: `正在删除 ${ids.length} 篇文档...`,
            success: `已删除 ${ids.length} 篇文档`,
            error: "删除失败，请稍后重试",
        });
    };

    const handleMouseDown = (
        event: React.MouseEvent<HTMLDivElement, MouseEvent>
    ) => {
        event.preventDefault();
        event.stopPropagation();

        isResizingRef.current = true;
        document.addEventListener("mousemove", handleMouseMove);
        document.addEventListener("mouseup", handleMouseUp);
    };

    const handleMouseMove = (e: MouseEvent) => {
        if (!isResizingRef.current) return;
        dragMoved.current = true;
        let newWidth = e.clientX;

        if (newWidth < 240) newWidth = 240;
        if (newWidth > 480) newWidth = 480;

        if (sidebarRef.current && navbarRef.current) {
            sidebarRef.current.style.width = `${newWidth}px`;
            navbarRef.current.style.setProperty("left", `${newWidth}px`);
            navbarRef.current.style.setProperty("width", `calc(100% - ${newWidth}px)`);
        }
    };

    const handleMouseUp = () => {
        isResizingRef.current = false;
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        // click 在 mouseup 后同步派发，下一事件循环再复位标志
        setTimeout(() => { dragMoved.current = false; }, 0);
    };

    const resetWidth = () => {
        if (sidebarRef.current && navbarRef.current) {
            setIsCollapsed(false);
            setIsResetting(true);

            sidebarRef.current.style.width = isMobile ? "100%" : "240px";
            navbarRef.current.style.setProperty("left", isMobile ? "0" : "240px");
            navbarRef.current.style.setProperty(
                "width",
                isMobile ? "100%" : "calc(100% - 240px)"
            );
            setTimeout(() => setIsResetting(false), 300);
        }
    };

    const collapse = () => {
        if (sidebarRef.current && navbarRef.current) {
            setIsCollapsed(true);
            setIsResetting(true);

            sidebarRef.current.style.width = "0";
            navbarRef.current.style.setProperty("width", "100%");
            navbarRef.current.style.setProperty("left", "0");

            setTimeout(() => setIsResetting(false), 300);
        }
    };

    return (
        <>
            <aside
                ref={sidebarRef}
                className={cn(
                    "group/sidebar h-full bg-sidebar relative flex w-60 flex-col z-[99999] before:absolute before:top-0 before:left-0 before:h-[3px] before:w-full before:bg-ai",
                    isResetting && "transition-[width] ease-in-out duration-300",
                    isMobile && "w-0"
                )}>
                {/* 品牌区：荧光笔标记 + 字标 + 折叠按钮（固定顶部，替代原悬浮按钮） */}
                <div className="flex items-center gap-2 px-3 pt-3.5 pb-1 shrink-0">
                    <div className="flex h-6 w-6 items-center justify-center rounded-md bg-ai text-ai-foreground">
                        <PenLine className="h-3.5 w-3.5" strokeWidth={2.5} />
                    </div>
                    <span className="font-display text-[15px] font-semibold tracking-tight">
                        Lotion
                    </span>
                    <div
                        onClick={collapse}
                        role="button"
                        title="折叠侧边栏"
                        className={cn(
                            "ml-auto flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-foreground transition-colors cursor-pointer",
                            isMobile && "opacity-100"
                        )}
                    >
                        <ChevronsLeft className="h-4 w-4" />
                    </div>
                </div>

                {/* 用户区（固定顶部） */}
                <div className="shrink-0">
                    <UserItem />
                </div>

                {/* 工具区：搜索 + AI 助手（固定顶部） */}
                <div className="px-2.5 pt-1 space-y-0.5 shrink-0">
                    <Item
                        label="搜索"
                        icon={Search}
                        isSearch
                        onClick={toggle}
                    />
                    <Item
                        label="AI 助手"
                        icon={Sparkles}
                        highlighted
                        onClick={aiPanelToggle}
                    />
                </div>

                {/* 文档区：独立滚动（长列表不挤占工具与管理区） */}
                <div className="flex-1 overflow-y-auto min-h-0 mt-3">
                    <div className="flex items-center px-3 pb-1">
                        <span className="text-[11px] font-medium tracking-wide text-muted-foreground/70">
                            我的文档
                        </span>
                        <button
                            onClick={onCreate}
                            title="新建笔记"
                            className="ml-auto flex h-5 w-5 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-foreground transition-colors cursor-pointer"
                        >
                            <Plus className="h-3.5 w-3.5" />
                        </button>
                    </div>
                    <DocumentList
                        batchMode={batchMode}
                        selected={selected}
                        onToggleCheck={toggleCheck}
                    />
                </div>

                {/* 管理区：固定在底部（设置/批量删除/回收站随时可达） */}
                <div className="border-t border-sidebar-border px-2.5 pt-1.5 pb-2 space-y-0.5 shrink-0">
                    <Item
                        label="设置"
                        icon={Settings}
                        onClick={settingsOnOpen}
                    />
                    <Item
                        label="批量删除"
                        icon={ListChecks}
                        onClick={() => setBatchMode(true)}
                    />
                    <Popover>
                        <PopoverTrigger className="w-full">
                            <Item label="回收站" icon={Trash} />
                        </PopoverTrigger>

                        <PopoverContent
                            className="p-0 w-72"
                            side={isMobile ? "bottom" : "right"}
                        >
                            <TrashBox />
                        </PopoverContent>
                    </Popover>
                </div>

                {batchMode && (
                    <div className="border-t bg-sidebar px-3 py-2 flex items-center gap-2 shrink-0">
                        <span className="text-xs text-muted-foreground flex-1 truncate">
                            已选 {selected.size} 篇
                        </span>
                        <ConfirmModal onConfirm={batchDelete}>
                            <Button
                                size="sm"
                                variant="destructive"
                                disabled={selected.size === 0}
                                className="h-7 text-xs cursor-pointer"
                            >
                                删除
                            </Button>
                        </ConfirmModal>
                        <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs cursor-pointer"
                            onClick={exitBatchMode}
                        >
                            取消
                        </Button>
                    </div>
                )}

                <div
                    onMouseDown={(e) => { handleMouseDown(e); }}
                    onClick={() => { if (dragMoved.current) return; resetWidth(); }}
                    className="opacity-0 group-hover/sidebar:opacity-100 transition cursor-ew-resize absolute h-full w-[3px] bg-primary/10 hover:bg-ai/60 right-0 top-0" />
            </aside>

            <div ref={navbarRef} id="main-navbar" className={cn(
                "absolute top-0 z-[99999] before:absolute before:top-0 before:left-0 before:h-[3px] before:w-full before:bg-ai",
                !isCollapsed && !isMobile && "left-60 w-[calc(100%-240px)]",
                isCollapsed && !isMobile && "left-0 w-full",
                isResetting && "transition-[left,width] ease-in-out duration-300",
                isMobile && "left-0 w-full"
            )}>
                {!!params.documentId ? (
                    <Navbar
                        isCollapsed={isCollapsed}
                        onResetWidth={resetWidth}
                    />
                ) : (
                    <nav className="bg-transparent px-3 py-2 w-full">
                        {
                            isCollapsed && <MenuIcon onClick={resetWidth} role="button" className="h-6 w-6 text-muted-foreground" />
                        }
                    </nav>
                )}
            </div>
        </>
    );
};

export default Navigation;
