import { useState } from "react";
import useCoverImage from "../../hooks/use-cover-image";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { SingleImageDropzone } from "../upload/single-image";
import { useEdgeStore } from "../../lib/edgestore";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useParams } from "next/navigation";
import { Id } from "../../convex/_generated/dataModel";
import { UploaderProvider, UploadFn } from "../upload/uploader-provider";
import { SingleImageDropzoneUsage } from "../single-image-dropzone";
import React from "react";
import { log } from "console";

const CoverImageModal = () => {
    const [file, setFile] = useState<File>();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const params = useParams();

    const coverImage = useCoverImage();
    const { edgestore } = useEdgeStore();
    const update = useMutation(api.documents.update);

    const onClose = () => {
        setFile(undefined);
        setIsSubmitting(false);
        coverImage.onClose();
    };

    const uploadFn: UploadFn = async ({ file }) => {
        const res = await edgestore.publicFiles.upload({
            file,
            options: {
                replaceTargetUrl: coverImage.url
            }
        });

        await update({
            id: params.documentId as Id<"documents">,
            coverImage: res.url
        });

        onClose();

        return res;
    };

    return (
        <Dialog open={coverImage.isOpen} onOpenChange={coverImage.onClose}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle className="text-center text-lg font-semibold">
                        Cover Image
                    </DialogTitle>
                </DialogHeader>
                <UploaderProvider uploadFn={uploadFn} autoUpload>
                    <SingleImageDropzone
                        dropzoneOptions={{
                            maxSize: 1024 * 1024 * 3, // 1 MB
                        }}
                    />
                </UploaderProvider>
            </DialogContent>
        </Dialog>
    );
};

export default CoverImageModal;