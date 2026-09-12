// AI 工具目录（内置工具的元数据 + 摘要文案）与内置工具注册入口。
//
// 组装职责已搬到 lib/ai/tools/registry.ts（注册表驱动）：本文件只负责
// 「内置工具长什么样」，以及把它们注册进注册表。
// 加一个工具 = 写好工厂文件 + 在 registerBuiltinTools 清单里加一行；插件也可以自己 register，
// 元数据随定义走，因此 agent 与组装代码都不需要改。
import type Database from "better-sqlite3";
import type { ToolSet } from "ai";
import { createSearchNotesTool } from "./search-notes";
import { createReadNoteTool } from "./read-note";
import { createCreateNoteTool } from "./create-note";
import { createUpdateNoteTool } from "./update-note";
import { createRenameNoteTool } from "./rename-note";
import { createMoveNoteTool } from "./move-note";
import { createSetNoteIconTool } from "./set-note-icon";
import { createPublishNoteTool } from "./publish-note";
import { createArchiveNoteTool } from "./archive-note";
import { createRestoreNoteTool } from "./restore-note";
import { createListTrashTool } from "./list-trash";
import { createDeleteNoteTool } from "./delete-note";
import { createListNotesTool } from "./list-notes";
import { createAskUserTool } from "./ask-user";
import { createTodoWriteTool } from "./todo-write";
import { createGetDocInfoTool } from "./doc-info";
import { createGetDocOutlineTool } from "./doc-outline";
import { createGetDocBlocksTool } from "./doc-blocks";
import { createUpdateBlockTool } from "./update-block";
import { buildToolSet, createHostToolRegistry, type AnyTool, type HostToolRegistry } from "./registry";
import { createDoomLoopTracker, summariseFallback, type DoomLoopTracker, type ToolEvent, type ToolName } from "./runtime";

// 公共件住在 ./runtime（注册表也用它）；这里按旧路径再导出，保持向后兼容
export {
  argsText,
  createDoomLoopTracker,
  DOOM_LOOP_STOP_THRESHOLD,
  DOOM_LOOP_WARN_THRESHOLD,
  looksLikeFailure,
  summariseFallback,
  TOOL_TIMEOUT_MS,
  truncate,
  wrapToolOutput,
} from "./runtime";
export type { DoomLoopHandlers, DoomLoopTracker, ToolEvent, ToolName } from "./runtime";

/** 工具元数据：名称 / 展示标签 / 图标 / 描述（工具定义与展示同处维护） */
export const TOOL_META: Record<ToolName, { label: string; icon: string; description: string }> = {
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

/** 兼容旧引用：工具中文标签映射 */
export const TOOL_LABELS: Record<string, string> = Object.fromEntries(
  Object.entries(TOOL_META).map(([k, v]) => [k, `${v.icon} ${v.label}`]),
);

/**
 * 每个工具的结果摘要（tool_end 卡片 summary）：
 * 从返回给模型的文本里提取一句人话，带工具自身的语义，
 * 失败/缺失时降级为错误信息或结果前 60 字。
 */
function summarizeResult(tool: ToolName, result: string): string {
  const pick = (re: RegExp): string | null => {
    const m = result.match(re);
    return m ? m[1] : null;
  };
  switch (tool) {
    case "searchNotes": {
      const n = pick(/找到 (\d+) 篇笔记/);
      return n !== null ? "找到 " + n + " 篇笔记" : "完成搜索";
    }
    case "readNote": {
      const t = pick(/笔记「([^」]+)」/);
      return t ? "已读取「" + t + "」" : "完成读取";
    }
    case "createNote": {
      const t = pick(/笔记「([^」]+)」已创建/);
      return t ? "已创建「" + t + "」（草稿）" : "已创建草稿";
    }
    case "updateNote": return "内容已更新";
    case "renameNote": {
      const t = pick(/「([^」]+)」/);
      return t ? "已重命名为「" + t + "」" : "已重命名";
    }
    case "listNotes":
    case "listTrash": {
      const n = pick(/找到 (\d+) 篇笔记/) ?? pick(/回收站中有 (\d+) 篇笔记/);
      return n !== null ? "找到 " + n + " 篇笔记" : "完成浏览";
    }
    case "moveNote": {
      const t = pick(/「([^」]+)」已移动/);
      return t ? "已移动「" + t + "」" : "等待用户确认移动";
    }
    case "setNoteIcon": return "图标已更新";
    case "publishNote": {
      const p = pick(/已取消发布/);
      return p !== null ? "已取消发布" : "已发布";
    }
    case "restoreNote": {
      const t = pick(/「([^」]+)」已从回收站恢复/);
      return t ? "已恢复「" + t + "」" : "已恢复";
    }
    case "archiveNote": return "已归档到回收站";
    case "deleteNote": return "等待用户确认删除";
    case "askUser": {
      const n = pick(/已向用户提出结构化问题/);
      return n !== null ? "已向用户提问" : "已提问";
    }
    case "todoWrite": {
      const n = pick(/任务清单已更新（共 (\d+) 项/);
      return n !== null ? "任务清单已更新（" + n + " 项）" : "任务清单已更新";
    }
    case "getDocInfo": {
      const t = pick(/「([^」]+)」信息/);
      return t ? "已读取「" + t + "」信息" : "已读取笔记信息";
    }
    case "getDocOutline": {
      const t = pick(/「([^」]+)」大纲/);
      return t ? "已读取「" + t + "」大纲" : "已读取大纲";
    }
    case "getDocBlocks": {
      const n = pick(/共 (\d+) 块/);
      return n !== null ? "已列出 " + n + " 个块" : "已读取块清单";
    }
    case "updateBlock": {
      const m = result.match(/已更新笔记「([^」]+)」第 (\d+) 块/);
      return m ? "已更新「" + m[1] + "」第 " + m[2] + " 块" : "已更新块";
    }
  }
  return summariseFallback(result);
}
/**
 * 注册内置工具。插件也可以往同一个注册表加自己的工具：
 *   ctx.inject(["tools"], (c) => requireTools(c).register({ name, label, icon, description, create }))
 */
export function registerBuiltinTools(registry: HostToolRegistry): void {
  const builtins: Array<{
    name: ToolName;
    /** 需要副作用上报的工具把 onEvent 传进工厂 */
    create: (db: Database.Database, userId: string, onEvent: (e: ToolEvent) => void) => AnyTool;
  }> = [
    { name: "searchNotes", create: (db, userId) => createSearchNotesTool(db, userId) },
    { name: "listNotes", create: (db, userId) => createListNotesTool(db, userId) },
    { name: "readNote", create: (db, userId, onEvent) => createReadNoteTool(db, userId, onEvent) },
    { name: "createNote", create: (db, userId, onEvent) => createCreateNoteTool(db, userId, onEvent) },
    { name: "updateNote", create: (db, userId, onEvent) => createUpdateNoteTool(db, userId, onEvent) },
    { name: "renameNote", create: (db, userId, onEvent) => createRenameNoteTool(db, userId, onEvent) },
    { name: "moveNote", create: (db, userId, onEvent) => createMoveNoteTool(db, userId, onEvent) },
    { name: "setNoteIcon", create: (db, userId, onEvent) => createSetNoteIconTool(db, userId, onEvent) },
    { name: "publishNote", create: (db, userId, onEvent) => createPublishNoteTool(db, userId, onEvent) },
    { name: "archiveNote", create: (db, userId) => createArchiveNoteTool(db, userId) },
    { name: "restoreNote", create: (db, userId, onEvent) => createRestoreNoteTool(db, userId, onEvent) },
    { name: "listTrash", create: (db, userId) => createListTrashTool(db, userId) },
    { name: "deleteNote", create: (db, userId, onEvent) => createDeleteNoteTool(db, userId, onEvent) },
    { name: "askUser", create: (db, userId, onEvent) => createAskUserTool(db, userId, onEvent) },
    { name: "todoWrite", create: (db, userId, onEvent) => createTodoWriteTool(db, userId, onEvent) },
    { name: "getDocInfo", create: (db, userId) => createGetDocInfoTool(db, userId) },
    { name: "getDocOutline", create: (db, userId) => createGetDocOutlineTool(db, userId) },
    { name: "getDocBlocks", create: (db, userId) => createGetDocBlocksTool(db, userId) },
    { name: "updateBlock", create: (db, userId, onEvent) => createUpdateBlockTool(db, userId, onEvent) },
  ];

  for (const item of builtins) {
    const meta = TOOL_META[item.name];
    registry.register({
      name: item.name,
      label: meta.label,
      icon: meta.icon,
      description: meta.description,
      summarize: (text) => summarizeResult(item.name, text),
      create: ({ db, userId, onEvent }) =>
        item.create(db as Database.Database, userId, onEvent as (e: ToolEvent) => void),
    });
  }
}

/** 内置工具的默认注册表（无内核服务时的路径：单测与脚本用） */
export function createDefaultToolRegistry(): HostToolRegistry {
  const registry = createHostToolRegistry();
  registerBuiltinTools(registry);
  return registry;
}

/**
 * 创建 Agent 工具集（兼容入口）：等价于「内置注册表 → 组装」。
 * 需要插件贡献工具时走内核的 tools 服务（见 server/composition.ts 的 tools-registry 条目）。
 */
export function createTools(
  db: Database.Database,
  userId: string,
  onEvent: (event: ToolEvent) => void = () => {},
  doom: DoomLoopTracker = createDoomLoopTracker({}),
): ToolSet {
  return buildToolSet(createDefaultToolRegistry(), { db, userId, onEvent, doom });
}
