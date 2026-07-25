import { create } from "zustand";

export const useRefresh = create<{ key: number; trigger: () => void }>((set) => ({
  key: 0,
  trigger: () => set((s) => ({ key: s.key + 1 })),
}));
