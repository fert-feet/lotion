"use client";

import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "../../../components/ui/button";
import ConfirmModal from "../../../components/modals/confirm-modal";
import { useUser } from "@/hooks/use-user";
import { useRefresh } from "@/hooks/use-refresh";
import { remove, restore } from "@/lib/db";
import { Archive, Trash2, Undo2 } from "lucide-react";

interface BannerProps {
    documentId: string;
}

const Banner = ({
    documentId
}: BannerProps) => {
    const router = useRouter();
    const { user } = useUser();
    const triggerSidebar = useRefresh((s) => s.triggerSidebar);
    const triggerDocument = useRefresh((s) => s.triggerDocument);

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
            triggerDocument(documentId); // 刷新文档详情，让归档横幅消失
        });

        toast.promise(promise, {
            loading: "Restoring note...",
            success: "Note restored",
            error: "Failed to restore"
        });
    };

    return (
        <div className="w-full border-b bg-muted border-border">
            <div className="max-w-3xl lg:max-w-4xl mx-auto flex items-center gap-3 px-4 py-2.5">
                <Archive className="h-4 w-4 text-foreground shrink-0" />
                <p className="text-sm font-medium text-foreground flex-1">
                    此页面已在回收站
                </p>
                <Button
                    size="sm"
                    variant="outline"
                    onClick={onRestore}
                    className="h-7 text-xs"
                >
                    <Undo2 className="h-3.5 w-3.5 mr-1" />
                    恢复
                </Button>
                <ConfirmModal onConfirm={onRemove}>
                    <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs text-muted-foreground hover:text-destructive"
                    >
                        <Trash2 className="h-3.5 w-3.5 mr-1" />
                        永久删除
                    </Button>
                </ConfirmModal>
            </div>
        </div>
    );
};

export default Banner;
