import { useMutation, useQuery } from "convex/react";
import { useParams, useRouter } from "next/navigation";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { toast } from "sonner";
import { routerServerGlobal } from "next/dist/server/lib/router-utils/router-server-context";
import { useState } from "react";
import { Spinner } from "../../../components/ui/spinner";
import { Search, Trash, Undo } from "lucide-react";
import { Input } from "../../../components/ui/input";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "../../../components/ui/alert-dialog";
import ConfirmModal from "../../../components/modals/confirm-modal";

const TrashBox = () => {
    const params = useParams();
    const router = useRouter();

    const documents = useQuery(api.documents.getTrash, {});
    const restore = useMutation(api.documents.restore);
    const remove = useMutation(api.documents.remove);

    const [search, setSearch] = useState("");

    const filterDocuments = documents?.filter((document) => {
        return document.title.toLowerCase().includes(search.toLowerCase());
    });

    const handleClick = (documentId: string) => {
        router.push(`/documents/${documentId}`);
    };

    const onRemove = (
        documentId: Id<"documents">
    ) => {
        const promise = remove({ id: documentId });

        toast.promise(promise, {
            loading: "Removing note...",
            success: "Note removed",
            error: "Failed to remove"
        });

        if (params.documentId === documentId) {
            router.push(`/documents/${documentId}`);
        }
    };

    const onRestore = (
        event: React.MouseEvent<HTMLDivElement, MouseEvent>,
        documentId: Id<"documents">
    ) => {
        event.stopPropagation();

        const promise = restore({ id: documentId });

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
                    className="h-7 px-2 focus-visible:ring-transparent bg-secondary"
                    placeholder="Filter by page title..."
                />

            </div>
            <div className="mt-2 px-1 pb-1">
                <p className="hidden last:block text-xs text-center text-muted-foreground pb-2k">
                    No document Found
                </p>
                {filterDocuments?.map((document) => (
                    <div
                        key={document._id}
                        role="button"
                        className="text-sm rounded-sm w-full items-center text-primary hover:bg-primary/5 flex justify-between cursor-pointer group"
                        onClick={() => handleClick(document._id)} // () => func()适合需要传参，如果直接放 func() 会直接执行
                    >
                        <span className="truncate pl-2">
                            {document.title}
                        </span>
                        <div className="flex items-center group-hover:opacity-100 opacity-0">
                            <div
                                role="button"
                                className="rounded-sm p-2 hover:bg-neutral-300 dark:hover:bg-neutral-600"
                                onClick={(e) => onRestore(e, document._id)}
                            >
                                <Undo className="h-4 w-4 text-muted-foreground" />
                            </div>
                            <div>

                            </div>
                            <ConfirmModal
                                onConfirm={() => onRemove(document._id)}
                            >
                                <div
                                    role="button"
                                    className="rounded-sm p-2 hover:bg-neutral-300 dark:hover:bg-neutral-600"
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