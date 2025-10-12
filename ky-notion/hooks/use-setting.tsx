
import { create } from "zustand";



type SettingStore = {
    isOpen: boolean;
    onOpen: () => void;
    onClose: () => void;
};

const useSettings = create<SettingStore>((set) => ({
    isOpen: false,
    onOpen: () => set({isOpen: true}),
    onClose: () => set({isOpen: false}),
}))

export default useSettings;