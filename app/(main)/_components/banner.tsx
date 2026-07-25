"use client";

import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "../../../components/ui/button";
import ConfirmModal from "../../../components/modals/confirm-modal";
import { useSupabaseUser } from "@/hooks/use-supabase-user";
import { useRefresh } from "@/hooks/use-refresh";
import { remove, restore } from "@/lib/db";

interface BannerProps {
    documentId: string;
}

const Banner = ({
    documentId
}: BannerProps) => {
    const router = useRouter();
    const { user } = useSupabaseUser();
    const triggerSidebar = useRefresh((s) => s.triggerSidebar);

    const onRemove = () => {
        const promise = remove(documentId).then(() => {
            triggerSidebar();
            router.push("/documents");
        });

        toast.promise(promise, {
            loading: "Removing note...",
            success: "Note removed",
            error: "Failed to remove"
        });
    };

    const onRestore = () => {
        if (!user) return;
        const promise = restore(user.id, documentId).then(() => {
            triggerSidebar();
        });

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
