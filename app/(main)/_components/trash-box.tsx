import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useState, useEffect } from "react";
import { Spinner } from "../../../components/ui/spinner";
import { Search, Trash, Undo } from "lucide-react";
import { Input } from "../../../components/ui/input";
import ConfirmModal from "../../../components/modals/confirm-modal";
import { useSupabaseUser } from "@/hooks/use-supabase-user";
import { useRefresh } from "@/hooks/use-refresh";
import { getTrash, restore, remove, type SidebarDocument } from "@/lib/db";

const TrashBox = () => {
    const router = useRouter();
    const { user } = useSupabaseUser();
    const triggerSidebar = useRefresh((s) => s.triggerSidebar);

    const [documents, setDocuments] = useState<SidebarDocument[] | undefined>(undefined);
    const [search, setSearch] = useState("");

    const loadTrash = () => {
        if (user) {
            getTrash(user.id)
                .then(setDocuments)
                .catch(() => setDocuments([])); // 失败显示空列表，避免无限 Spinner
        }
    };

    useEffect(() => { loadTrash(); }, [user]);

    const filterDocuments = documents?.filter((document) => {
        return document.title.toLowerCase().includes(search.toLowerCase());
    });

    const handleClick = (documentId: string) => {
        router.push(`/documents/${documentId}`);
    };

    const onRemove = (documentId: string) => {
        const promise = remove(documentId).then(() => {
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
        const promise = restore(user.id, documentId).then(() => {
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
            <div className="h-full flex items-center justify-center p-4">
                <Spinner className="size-8" />
            </div>
        );
    }

    return (
        <div className="text-sm">
            <div className="gap-x-1 flex items-center p-2">
                <Search className="h-4 w-4 mr-1" />
                <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="h-7 px-2 bg-secondary"
                    placeholder="Filter by page title..."
                />

            </div>
            <div className="mt-2 px-1 pb-1">
                <p className="hidden last:block text-xs text-center text-muted-foreground pb-2">
                    No document Found
                </p>
                {filterDocuments?.map((document) => (
                    <div
                        key={document.id}
                        role="button"
                        className="text-sm rounded-sm w-full items-center text-primary hover:bg-primary/5 flex justify-between cursor-pointer group"
                        onClick={() => handleClick(document.id)}
                    >
                        <span className="truncate pl-2">
                            {document.title}
                        </span>
                        <div className="flex items-center group-hover:opacity-100 opacity-0 max-md:opacity-100">
                            <div
                                role="button"
                                className="rounded-sm p-2 hover:bg-secondary"
                                onClick={(e) => onRestore(e, document.id)}
                            >
                                <Undo className="h-4 w-4 text-muted-foreground" />
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
                                    <Trash
                                        className="h-4 w-4 text-muted-foreground"
                                    />
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
