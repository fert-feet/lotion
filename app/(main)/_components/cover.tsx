"use client";

import Image from "next/image";
import { cn } from "../../../lib/utils";
import { Button } from "../../../components/ui/button";
import { ImageIcon, X } from "lucide-react";
import useCoverImage from "../../../hooks/use-cover-image";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { removeCoverImage } from "@/lib/db";
import { useRefresh } from "@/hooks/use-refresh";
import { Skeleton } from "../../../components/ui/skeleton";

interface CoverProps {
    url?: string,
    preview?: boolean;
}

const Cover = ({
    url,
    preview
}: CoverProps) => {
    const params = useParams();
    const coverImage = useCoverImage();
    const triggerDocument = useRefresh((s) => s.triggerDocument);

    const onRemove = async () => {
        const documentId = params.documentId as string;
        if (!documentId) return;
        try {
            if (url) {
                const supabase = createClient();
                const pathMatch = url.match(/\/lotion\/(.+)$/);
                if (pathMatch) {
                    await supabase.storage.from("lotion").remove([pathMatch[1]]);
                }
            }
            removeCoverImage(documentId)
                .then(() => triggerDocument(documentId))
                .catch(console.error);
        } catch {
            // storage 删除失败不阻塞移除封面字段
            removeCoverImage(documentId)
                .then(() => triggerDocument(documentId))
                .catch(console.error);
        }
    };

    return (
        <div className={cn(
            "relative w-full h-[35vh] group",
            !url && "h-[12vh]",
            url && "bg-muted"
        )}>
            {!!url && (
                <Image
                    src={url}
                    fill
                    alt="Cover"
                    className="object-cover"
                />
            )}
            {url && !preview && (
                <div className="opacity-0 transition group-hover:opacity-100 max-md:opacity-100 absolute bottom-2 right-3 flex items-center gap-x-2">
                    <Button
                        onClick={() => coverImage.onReplace(url)}
                        className="text-muted-foreground text-xs cursor-pointer"
                        variant={"outline"}
                        size={"sm"}
                    >
                        <ImageIcon className="h-4 w-4 mr-2" />
                        Change cover
                    </Button>
                    <Button
                        onClick={onRemove}
                        className="text-muted-foreground text-xs cursor-pointer"
                        variant={"outline"}
                        size={"sm"}
                    >
                        <X className="h-4 w-4 mr-2" />
                        Remove cover
                    </Button>
                </div>
            )}
        </div>
    );
};

Cover.Skeleton = function CoverSkeleton() {
    return (
        <Skeleton className="w-full h-[12vh]" />
    );
};

export default Cover;
