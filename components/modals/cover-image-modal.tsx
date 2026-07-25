import useCoverImage from "../../hooks/use-cover-image";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { SingleImageDropzone } from "../upload/single-image";
import { useParams } from "next/navigation";
import { UploaderProvider, UploadFn } from "../upload/uploader-provider";
import { createClient } from "@/lib/supabase/client";
import { update } from "@/lib/db";
import { useRefresh } from "@/hooks/use-refresh";

const CoverImageModal = () => {
    const params = useParams();
    const coverImage = useCoverImage();
    const triggerDocument = useRefresh((s) => s.triggerDocument);

    const onClose = () => {
        coverImage.onClose();
    };

    const uploadFn: UploadFn = async ({ file }) => {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error("Not authenticated");

        const fileExt = file.name.split(".").pop();
        const path = `${user.id}/${Date.now()}.${fileExt}`;

        const { error } = await supabase.storage.from("lotion").upload(path, file);

        if (error) throw error;

        const { data: urlData } = supabase.storage.from("lotion").getPublicUrl(path);

        await update(params.documentId as string, { coverImage: urlData.publicUrl });
        triggerDocument(params.documentId as string);

        onClose();

        return { url: urlData.publicUrl };
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
