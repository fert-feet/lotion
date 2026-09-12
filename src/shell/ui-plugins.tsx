// 内置 UI 插件的组合清单（客户端侧）。
//
// 与 server/routes/index.ts 对称：**UI 也是插件注册出来的**。
// 详情栏面板（AI 助手）不再由 AppShell 直接 import —— AppShell 只渲染插槽，
// 具体是哪个面板由本清单里的插件决定（换面板 = 改一行清单，或用户层 patch 禁用）。
//
// 注意本文件**不被** src/kernel/client.ts 引用（避免 kernel → shell → kernel 的循环依赖）：
// 由应用根（src/app.tsx）通过 KernelProvider 的 extraPlugins 注入。
import type { ReactNode } from "react";
import type { Context, PluginEntry } from "@/lib/kernel";
import { requireUiSlots, UI_SLOTS_SERVICE } from "@/lib/seams/ui-slots";
import { LazyAiPanel } from "./lazy-panels";

/** 插槽名约定（区域.子区域） */
export const SLOT_DETAILS_PANEL = "details.panel";

/** 内置 UI 插件清单 */
export function shellUiPlugins(): PluginEntry[] {
  return [
    {
      id: "ui-ai-panel",
      plugin: {
        name: "ui/ai-panel",
        inject: [UI_SLOTS_SERVICE],
        apply(ctx: Context) {
          requireUiSlots<ReactNode>(ctx).register({
            id: "ai-panel",
            slot: SLOT_DETAILS_PANEL,
            kind: "single",
            component: <LazyAiPanel />,
          });
        },
      },
    },
  ];
}
