import useCoverImage from "../../hooks/use-cover-image";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { SingleImageDropzone } from "../upload/single-image";
import { useParams } from "react-router";
import { UploaderProvider, UploadFn } from "../upload/uploader-provider";
import { useActor, useDocStore } from "@/src/kernel/react";
import { useRefresh } from "@/hooks/use-refresh";

const CoverImageModal = () => {
    const docStore = useDocStore();
    const actor = useActor();
    const params = useParams();
    const coverImage = useCoverImage();
    const triggerDocument = useRefresh((s) => s.triggerDocument);

    const onClose = () => {
        coverImage.onClose();
    };

    // 本地版：POST /api/upload（本地磁盘存储，见 server/routes/upload.ts 的图床 TODO）
    const uploadFn: UploadFn = async ({ file }) => {
        const form = new FormData();
        form.append("file", file);
        const res = await fetch("/api/upload", { method: "POST", body: form });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "上传失败");

        await docStore.update(actor, params.documentId as string, { coverImage: data.url });
        triggerDocument(params.documentId as string);

        onClose();

        return { url: data.url };
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
                            maxSize: 1024 * 1024 * 3,
                        }}
                    />
                </UploaderProvider>
            </DialogContent>
        </Dialog>
    );
};

export default CoverImageModal;
