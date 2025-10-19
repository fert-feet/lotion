"use client";

import { useMutation } from "convex/react";
import { Button } from "../../../components/ui/button";
import { Doc } from "../../../convex/_generated/dataModel";
import useOrigin from "../../../hooks/use-origin";
import { api } from "../../../convex/_generated/api";
import { useState } from "react";
import { Toaster } from "../../../components/ui/sonner";
import { toast } from "sonner";
import { Popover, PopoverTrigger } from "../../../components/ui/popover";
import { Globe } from "lucide-react";

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
            isPublished: true
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
        </Popover>
    );
};

export default Publish;