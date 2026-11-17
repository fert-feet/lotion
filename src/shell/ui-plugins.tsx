// 客户端 UI 扩展的稳定插槽名。
//
// AI 面板是 shell 的内建能力，不属于插件，也不通过 uiSlots 注入。
// 这里只保留第三方 UI 扩展仍会消费的插槽；内置 UI 插件当前为空。

/** 侧边栏底部动作（list 槽；第三方客户端插件的演示挂载点） */
export const SLOT_SIDEBAR_FOOTER_ACTION = "sidebar.footer.action";
