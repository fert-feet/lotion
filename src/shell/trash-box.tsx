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
            loading: "Removing note...",
            success: "Note removed",
            error: "Failed to remove"
        });
    };

    const onRestore = (
        event: React.MouseEvent<HTMLDivElement, MouseEvent>,
        documentId: string
    ) => {
        event.stopPropagation();

        if (!user) return;
        const promise = docStore.restore({ userId: user.id }, documentId).then(() => {
            triggerSidebar();
            loadTrash();
        });

        toast.promise(promise, {
            loading: "Restoring note...",
            success: "Note restored",
            error: "Failed to restore"
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
        <div className="flex max-h-[inherit] flex-col text-sm">
            <div className="gap-x-1 flex shrink-0 items-center p-2">
                <Search className="h-4 w-4 mr-1" />
                <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="h-7 px-2 text-[12px]"
                    placeholder="Filter by page title..."
                />

            </div>
            <div className="mt-2 min-h-0 flex-1 overflow-y-auto px-1 pb-1">
                <p className="hidden pb-2 text-center text-[12px] text-muted-foreground last:block">
                    No document Found
                </p>
                {filterDocuments?.map((document) => (
                    <div
                        key={document.id}
                        role="button"
                        className="group flex w-full cursor-pointer items-center justify-between rounded-[6px] px-1.5 py-1 text-[13px] text-shell-label-primary hover:bg-shell-row-hover"
                        onClick={() => handleClick(document.id)}
                    >
                        <span className="truncate">
                            {document.title}
                        </span>
                        <div className="flex items-center group-hover:opacity-100 opacity-0 max-md:opacity-100">
                            <div
                                role="button"
                                className="flex h-6 w-6 items-center justify-center rounded-[5px] text-shell-label-tertiary hover:bg-shell-row-active hover:text-shell-label-primary"
                                onClick={(e) => onRestore(e, document.id)}
                            >
                                <Undo className="h-3.5 w-3.5" />
                            </div>
                            <div>

                            </div>
                            <ConfirmModal
                                onConfirm={() => onRemove(document.id)}
                            >
                                <div
                                    role="button"
                                    className="rounded-sm p-2 hover:bg-secondary"
                                >
                                    <Trash className="h-3.5 w-3.5" />
                                </div>
                            </ConfirmModal>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default TrashBox;
