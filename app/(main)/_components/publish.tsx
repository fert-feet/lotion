"use client";

import { useMutation } from "convex/react";
import { Button } from "../../../components/ui/button";
import { Doc } from "../../../convex/_generated/dataModel";
import useOrigin from "../../../hooks/use-origin";
import { api } from "../../../convex/_generated/api";
import { useState } from "react";
import { Toaster } from "../../../components/ui/sonner";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "../../../components/ui/popover";
import { Check, Copy, Globe } from "lucide-react";

interface publishProps {
    initialData: Doc<"documents">;
}

const Publish = ({
    initialData
}: publishProps) => {
    const origin = useOrigin();
    const update = useMutation(api.documents.update);

    const [copied, setCopied] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const url = `${origin}/preview/${initialData._id}`;

    const onPublish = () => {
        setIsSubmitting(true);

        const promise = update({
            id: initialData._id,
            isPublished: true
        })
            .finally(() => setIsSubmitting(false));

        toast.promise(promise, {
            loading: "Publishing...",
            success: "Note published",
            error: "Failed to publish note"
        });
    };

    const onUnpublish = () => {
        setIsSubmitting(true);

        const promise = update({
            id: initialData._id,
            isPublished: false
        })
            .finally(() => setIsSubmitting(false));

        toast.promise(promise, {
            loading: "UnPublishing...",
            success: "Note Unpublished",
            error: "Failed to unpublish note"
        });
    };

    const onCopy = () => {
        navigator.clipboard.writeText(url);
        setCopied(true);
        toast.info("Copied");

        setTimeout(() => {
            setCopied(false);
        }, 1000);
    };

    return (
        <Popover>
            <PopoverTrigger asChild>
                <Button size={"sm"} variant={"ghost"}>
                    Publish
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
                            <p className="text-xs text-sky-500 font-medium">
                                This note is live on web.
                            </p>
                        </div>
                        <div className="flex items-center">
                            <input
                                value={url}
                                disabled
                                className="flex-1 px-2 text-xs border rounded-l-md h-8 bg-muted"
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
                            className="w-full text-xs"
                            size={"sm"}
                        >
                            Unpublish
                        </Button>
                    </div>
                ) : (
                    <div className="flex flex-col items-center gap-y-2 justify-center">
                        <Globe
                            className="h-8 w-8 text-muted-foreground"
                        />
                        <p className="text-sm font-medium">
                            Publish this note
                        </p>
                        <span className="text-xs text-muted-foreground mb-1">
                            Share your work with others
                        </span>
                        <Button
                            disabled={isSubmitting}
                            onClick={onPublish}
                            className="w-full text-xs"
                            size={"sm"}
                        >
                            Publish
                        </Button>
                    </div>
                )}
            </PopoverContent>
        </Popover>
    );
};

export default Publish;