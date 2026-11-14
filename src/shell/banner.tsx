"use client";

import { toast } from "sonner";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import ConfirmModal from "@/components/modals/confirm-modal";
import { useUser } from "@/hooks/use-user";
import { useRefresh } from "@/hooks/use-refresh";
import { useActor, useDocStore } from "@/src/kernel/react";
import { Archive, Trash2, Undo2 } from "@/components/icons";

interface BannerProps {
    documentId: string;
}

const Banner = ({
    documentId
}: BannerProps) => {
    const docStore = useDocStore();
    const actor = useActor();
    const navigate = useNavigate();
    const { user } = useUser();
    const triggerSidebar = useRefresh((s) => s.triggerSidebar);
    const triggerDocument = useRefresh((s) => s.triggerDocument);

    const onRemove = () => {
        const promise = docStore.remove(actor, documentId).then(() => {
            triggerSidebar();
            navigate("/documents");
        });

        toast.promise(promise, {
            loading: "正在删除...",
            success: "已删除",
            error: "删除失败"
        });
    };

    const onRestore = () => {
        if (!user) return;
        const promise = docStore.restore({ userId: user.id }, documentId).then(() => {
            triggerSidebar();
            triggerDocument(documentId); // 刷新文档详情，让归档横幅消失
        });

        toast.promise(promise, {
            loading: "正在恢复...",
            success: "已恢复",
            error: "恢复失败"
        });
    };

    return (
        <div className="w-full hairline-b border-shell-border bg-secondary">
            <div className="mx-auto flex max-w-3xl items-center gap-2.5 px-4 py-2 lg:max-w-4xl">
                <Archive className="h-4 w-4 text-foreground shrink-0" />
                <p className="flex-1 text-ui font-medium text-foreground">
                    此页面已在回收站
                </p>
                <Button
                    size="sm"
                    variant="outline"
                    onClick={onRestore}
                    className="h-7 text-ui-sm"
                >
                    <Undo2 className="h-3.5 w-3.5 mr-1" />
                    恢复
                </Button>
                <ConfirmModal
                    onConfirm={onRemove}
                    title="永久删除这篇笔记？"
                    description="不会进入回收站，删除后无法恢复。"
                >
                    <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-ui-sm text-muted-foreground hover:text-destructive"
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
