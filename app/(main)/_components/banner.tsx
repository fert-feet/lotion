"use client";

import { toast } from "sonner";
import { Id } from "../../../convex/_generated/dataModel";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useRouter } from "next/navigation";
import { Button } from "../../../components/ui/button";
import ConfirmModal from "../../../components/modals/confirm-modal";

interface BannerProps {
    documentId: Id<"documents">;
}

const Banner = ({
    documentId
}: BannerProps) => {
    const router = useRouter();

    const remove = useMutation(api.documents.remove);
    const restore = useMutation(api.documents.restore);

    const onRemove = () => {
        const promise = remove({ id: documentId });

        toast.promise(promise, {
            loading: "Removing note...",
            success: "Note removed",
            error: "Failed to remove"
        });

        router.push("/documents");
    };

    const onRestore = () => {
        const promise = restore({ id: documentId });

        toast.promise(promise, {
            loading: "Restoring note...",
            success: "Note restored",
            error: "Failed to restore"
        });
    };

    return (
        <div className="w-full bg-rose-500 text-center text-sm p-2 text-white flex items-center justify-center gap-x-2">
            <p>
                This Page is Trash
            </p>
            <Button
                size="sm"
                onClick={onRestore}
                variant="outline"
                className="border-white bg-transparent hover:bg-primary/5 cursor-pointer text-white hover:text-white p-1 px-2 h-auto font-normal"
            >
                Restore Page
            </Button>
            <ConfirmModal
            onConfirm={onRemove}
            >
                <Button
                    size="sm"
                    variant="outline"
                    className="border-white bg-transparent hover:bg-primary/5 text-white hover:text-white p-1 px-2 h-auto font-normal cursor-pointer"
                >
                    Delete forever
                </Button>
            </ConfirmModal>
        </div>
    );
};

export default Banner;