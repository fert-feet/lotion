"use client";

import Image from "next/image";
import { cn } from "../../../lib/utils";
import { Button } from "../../../components/ui/button";
import { ImageIcon, X } from "lucide-react";
import useCoverImage from "../../../hooks/use-cover-image";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useParams } from "next/navigation";
import { Id } from "../../../convex/_generated/dataModel";

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
    const removeCoverImage = useMutation(api.documents.removeCoverImage);

    const onRemove = () => {
        removeCoverImage({
            id: params.documentId as Id<"documents">
        });
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
                <div className="opacity-0 transition group-hover:opacity-100 absolute bottom-2 right-3 flex items-center gap-x-2">
                    <Button
                        onClick={() => { }}
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

export default Cover;