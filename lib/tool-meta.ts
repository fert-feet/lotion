// AI 工具展示元数据的**单一真相源**（标签 / 图标 / 描述）。
//
// 为什么放在 lib/ 根而不是 lib/ai/：`test/boundary.test.ts` 禁止客户端值导入
// `@/lib/ai/*`（该目录会拉起 better-sqlite3 与世界知识），因此服务端
// （lib/ai/tools/index.ts 的工具定义）与客户端（AI 面板的工具卡片图标）只能
// 共享一个环境无关的模块。此前前端在 src/shell/ai/tool-card.tsx 里手抄了一份
// 7 条图标映射，19 个工具里 12 个退化成 ⚙️、2 个与这里不一致 —— 现在两侧同源。
//
// ⚠️ 本模块必须保持环境无关：不得 import node:/better-sqlite3/React。

/** 工具名（运行时是字符串：插件也能注册自己的工具） */
export type ToolName = string;

export interface ToolMeta {
  label: string;
  icon: string;
  description: string;
}

/** 内置工具目录（19 个）。键即工具名，与 registry 注册名一一对应 */
export const TOOL_META: Record<string, ToolMeta> = {
  searchNotes: { label: "搜索笔记", icon: "🔍", description: "按标题和正文关键词搜索笔记" },
  listNotes: { label: "浏览笔记", icon: "📂", description: "浏览笔记目录（全部或指定父笔记的子文档）" },
  readNote: { label: "读取笔记", icon: "📖", description: "读取笔记完整内容" },
  createNote: { label: "创建笔记", icon: "✍️", description: "创建一篇新笔记" },
  updateNote: { label: "更新笔记", icon: "📝", description: "修改已有笔记内容" },
  renameNote: { label: "重命名", icon: "🏷️", description: "重命名笔记标题" },
  moveNote: { label: "移动笔记", icon: "📦", description: "移动笔记到其他父笔记下（需确认）" },
  setNoteIcon: { label: "设置图标", icon: "🎨", description: "设置或清除笔记的 emoji 图标" },
  publishNote: { label: "发布笔记", icon: "🌐", description: "发布或取消发布笔记（公开预览）" },
  archiveNote: { label: "归档笔记", icon: "🗄️", description: "归档到回收站（可恢复）" },
  restoreNote: { label: "恢复笔记", icon: "♻️", description: "从回收站恢复笔记" },
  listTrash: { label: "查看回收站", icon: "🗑️", description: "列出回收站中的笔记" },
  deleteNote: { label: "删除笔记", icon: "💥", description: "永久删除（需用户确认）" },
  askUser: { label: "询问用户", icon: "❓", description: "向用户提出结构化问题" },
  todoWrite: { label: "任务清单", icon: "✅", description: "维护会话多步任务清单" },
  getDocInfo: { label: "笔记信息", icon: "ℹ️", description: "读取笔记元数据信息" },
  getDocOutline: { label: "笔记大纲", icon: "📑", description: "读取笔记标题层级大纲" },
  getDocBlocks: { label: "块清单", icon: "🧩", description: "列出笔记块清单（定位用）" },
  updateBlock: { label: "更新块", icon: "🎯", description: "精确更新单个块（锚点/序号）" },
};

/** 未登记的（插件注册的）工具兜底图标 */
export const FALLBACK_TOOL_ICON = "⚙️";

/** 工具图标（插件工具回退到 ⚙️） */
export function toolIcon(name: string): string {
  return TOOL_META[name]?.icon ?? FALLBACK_TOOL_ICON;
}

/** 工具标签（服务端 tool_start 事件已带 label，这里供降级与测试用） */
export function toolLabel(name: string): string {
  return TOOL_META[name]?.label ?? name;
}

/** 服务端探测工具结果摘要时的自描述文案（描述字段的消费方之一） */
export function toolDescription(name: string): string {
  return TOOL_META[name]?.description ?? "";
}
