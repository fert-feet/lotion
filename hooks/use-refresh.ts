import { create } from "zustand";

type RefreshStore = {
  /** 侧边栏文档列表刷新计数器 */
  sidebarKey: number;
  triggerSidebar: () => void;
  /** 单个文档刷新计数器，key 为 documentId */
  documentKeys: Record<string, number>;
  triggerDocument: (id: string) => void;
};

export const useRefresh = create<RefreshStore>((set) => ({
  sidebarKey: 0,
  triggerSidebar: () => set((s) => ({ sidebarKey: s.sidebarKey + 1 })),
  documentKeys: {},
  triggerDocument: (id: string) =>
    set((s) => ({
      documentKeys: {
        ...s.documentKeys,
        [id]: (s.documentKeys[id] || 0) + 1,
      },
    })),
}));
