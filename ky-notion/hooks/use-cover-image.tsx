import { create } from "zustand";



type CoverImageStore = {
    isOpen: boolean;
    onOpen: () => void;
    onClose: () => void;
};

const useCoverImage = create<CoverImageStore>((set) => ({
    isOpen: false,
    onOpen: () => set({isOpen: true}),
    onClose: () => set({isOpen: false}),
}))

export default useCoverImage;