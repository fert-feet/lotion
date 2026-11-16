import { useNavigate } from "react-router";
import { toast } from "sonner";
import { useState, useEffect, useCallback } from "react";
import { Spinner } from "@/components/ui/spinner";
import { Search, Trash, Undo } from "@/components/icons";
import { Input } from "@/components/ui/input";
import ConfirmModal from "@/components/modals/confirm-modal";
import { useUser } from "@/hooks/use-user";
import { useRefresh } from "@/hooks/use-refresh";
import type { SidebarDocument } from "@/lib/seams/doc-store";
import { useActor, useDocStore } from "@/src/kernel/react";

const TrashBox = () => {
    const docStore = useDocStore();
    const actor = useActor();
    const navigate = useNavigate();
    const { user } = useUser();
    const triggerSidebar = useRefresh((s) => s.triggerSidebar);

    const [documents, setDocuments] = useState<SidebarDocument[] | undefined>(undefined);
    const [search, setSearch] = useState("");

    const loadTrash = useCallback(() => {
        if (user) {
            docStore.listTrash({ userId: user.id })
                .then(setDocuments)
                .catch(() => setDocuments([])); // 失败显示空列表，避免无限 Spinner
        }
    }, [user, docStore]);

    useEffect(() => { loadTrash(); }, [loadTrash]);

    const filterDocuments = documents?.filter((document) => {
        return document.title.toLowerCase().includes(search.toLowerCase());
    });

    const handleClick = (documentId: string) => {
        navigate(`/documents/${documentId}`);
    };

    const onRemove = (documentId: string) => {
        const promise = docStore.remove(actor, documentId).then(() => {
            triggerSidebar();
            loadTrash();
        });

        toast.promise(promise, {
            loading: "正在删除...",
            success: "已删除",
            error: "删除失败"
        });
    };

    const onRestore = (
        event: React.MouseEvent<HTMLElement, MouseEvent>,
        documentId: string
    ) => {
        event.stopPropagation();

        if (!user) return;
        const promise = docStore.restore({ userId: user.id }, documentId).then(() => {
            triggerSidebar();
            loadTrash();
        });

        toast.promise(promise, {
            loading: "正在恢复...",
            success: "已恢复",
            error: "恢复失败"
        });
    };

    if (documents === undefined) {
        return (
            <div className="flex items-center justify-center p-8">
                <Spinner className="size-8" />
            </div>
        );
    }

    return (
        // 高度上限由父级 PopoverContent 的 max-h 决定：搜索框固定、列表区独立滚动，
        // 回收站文档很多时不会把浮层撑出视口
        <div className="flex max-h-[inherit] flex-col text-ui">
            <div className="gap-x-1 flex shrink-0 items-center p-2">
                <Search className="h-4 w-4 mr-1" />
                <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="h-7 px-2 text-ui-sm"
                    placeholder="按标题筛选..."
                />

            </div>
            <div className="mt-2 min-h-0 flex-1 overflow-y-auto px-1 pb-1">
                <p className="hidden pb-2 text-center text-ui-sm text-muted-foreground last:block">
                    没有匹配的笔记
                </p>
                {filterDocuments?.map((document) => (
                    <div
                        key={document.id}
                        role="button"
                        tabIndex={0}
                        // 行内含「恢复 / 永久删除」两个真按钮，因此整行不能用 <button>（不能嵌套）；
                        // 用 tabIndex + 键盘处理让它可达
                        onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                handleClick(document.id);
                            }
                        }}
                        className="group flex w-full cursor-pointer items-center justify-between rounded-control px-1.5 py-1 text-ui text-shell-label-primary hover:bg-shell-row-hover focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-shell-accent"
                        onClick={() => handleClick(document.id)}
                    >
                        <span className="truncate">
                            {document.title}
                        </span>
                        <div className="pointer-events-none flex items-center opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100">
                            <button
                                type="button"
                                aria-label={`恢复「${document.title || "未命名"}」`}
                                className="flex size-7 cursor-pointer items-center justify-center rounded-control bg-transparent p-0 text-shell-label-tertiary hover:bg-shell-row-active hover:text-shell-label-primary"
                                onClick={(e) => onRestore(e, document.id)}
                            >
                                <Undo className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                            <div>

                            </div>
                            <ConfirmModal
                                onConfirm={() => onRemove(document.id)}
                                title={`永久删除「${document.title || "未命名"}」？`}
                                description="不会进入回收站，删除后无法恢复。"
                            >
                                <button
                                    type="button"
                                    aria-label={`永久删除「${document.title || "未命名"}」`}
                                    className="flex size-7 cursor-pointer items-center justify-center rounded-control border-0 bg-transparent p-0 text-shell-label-tertiary hover:bg-secondary hover:text-destructive"
                                >
                                    <Trash className="h-3.5 w-3.5" aria-hidden="true" />
                                </button>
                            </ConfirmModal>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default TrashBox;
