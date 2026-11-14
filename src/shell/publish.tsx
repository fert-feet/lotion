"use client";

import { Button } from "@/components/ui/button";
import useOrigin from "@/hooks/use-origin";
import { useState } from "react";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Check, Copy, Globe } from "@/components/icons";
import type { Document } from "@/lib/seams/doc-store";
import { useActor, useDocStore } from "@/src/kernel/react";
import { useRefresh } from "@/hooks/use-refresh";

interface publishProps {
    initialData: Document;
}

const Publish = ({
    initialData
}: publishProps) => {
    const docStore = useDocStore();
    const actor = useActor();
    const origin = useOrigin();
    const [copied, setCopied] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const triggerDocument = useRefresh((s) => s.triggerDocument);

    const url = `${origin}/preview/${initialData.id}`;

    const onPublish = () => {
        setIsSubmitting(true);
        const promise = docStore.update(actor, initialData.id, { isPublished: true })
            .then(() => triggerDocument(initialData.id))
            .finally(() => setIsSubmitting(false));

        toast.promise(promise, {
            loading: "正在发布...",
            success: "已发布",
            error: "发布失败"
        });
    };

    const onUnpublish = () => {
        setIsSubmitting(true);
        const promise = docStore.update(actor, initialData.id, { isPublished: false })
            .then(() => triggerDocument(initialData.id))
            .finally(() => setIsSubmitting(false));

        toast.promise(promise, {
            loading: "正在取消发布...",
            success: "已取消发布",
            error: "取消发布失败"
        });
    };

    const onCopy = () => {
        // clipboard 在非 HTTPS / 权限拒绝时 reject，失败给出反馈而非静默
        navigator.clipboard
            .writeText(url)
            .then(() => {
                setCopied(true);
                toast.info("已复制");
            })
            .catch(() => toast.error("复制失败，请手动复制"));
        setTimeout(() => {
            setCopied(false);
        }, 1000);
    };

    return (
        <Popover>
            <PopoverTrigger asChild>
                <Button size={"sm"} variant={"ghost"}>
                    发布
                    {initialData.isPublished && (
                        <Globe
                            className="text-sky-500 w-4 h-4 ml-2"
                        />
                    )}
                </Button>
            </PopoverTrigger>
            <PopoverContent
                className="w-72"
                align="end"
                alignOffset={8}
                forceMount
            >
                {initialData.isPublished ? (
                    <div className="space-y-4">
                        <div className="flex gap-x-2 items-center">
                            <Globe
                                className="h-4 w-4 animate-pulse text-sky-500"
                            />
                            <p className="text-ui-sm text-sky-500 font-medium">
                                这篇笔记已公开到网络。
                            </p>
                        </div>
                        <div className="flex items-center">
                            <input
                                value={url}
                                disabled
                                className="h-8 flex-1 rounded-l-control hairline border-shell-border-l2 bg-secondary px-2 text-ui-sm text-shell-label-secondary"
                            />
                            <Button
                                onClick={onCopy}
                                disabled={copied}
                                className="h-8 rounded-l-none"
                            >
                                {copied ? (
                                    <Check className="h-4 w-4" />
                                ) : (
                                    <Copy className="h-4 w-4" />
                                )}
                            </Button>
                        </div>
                        <Button
                            disabled={isSubmitting}
                            onClick={onUnpublish}
                            className="w-full text-ui-sm"
                            size={"sm"}
                        >
                            取消发布
                        </Button>
                    </div>
                ) : (
                    <div className="flex flex-col items-center gap-y-2 justify-center">
                        <Globe
                            className="h-8 w-8 text-muted-foreground"
                        />
                        <p className="text-ui font-medium">
                            发布这篇笔记
                        </p>
                        <span className="text-ui-sm text-muted-foreground mb-1">
                            把这篇笔记分享出去
                        </span>
                        <Button
                            disabled={isSubmitting}
                            onClick={onPublish}
                            className="w-full text-ui-sm"
                            size={"sm"}
                        >
                            发布
                        </Button>
                    </div>
                )}
            </PopoverContent>
        </Popover>
    );
};

export default Publish;
