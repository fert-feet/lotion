import useCoverImage from "../../hooks/use-cover-image";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";

const CoverImageModal = () => {
    const coverImage = useCoverImage();

    return (
        <Dialog open={coverImage.isOpen} onOpenChange={coverImage.onClose}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle className="text-center text-lg font-semibold">
                        Cover Image
                    </DialogTitle>
                </DialogHeader>
                <div>
                    TODO: Upload image
                </div>
            </DialogContent>
        </Dialog>
    );
};

export default CoverImageModal;