// 内置插件的**元数据目录**（唯一真相源）。
//
// 组合清单（server/composition.ts、server/routes/index.ts、src/shell/ui-plugins.tsx）
// 只负责"挂什么"；本文件负责"叫什么、能不能禁用、配置长什么样"。
// 两边靠稳定 id 对齐：test/lib/plugins/catalog.test.ts 会校验每个组合条目都有元数据。
//
// ⚠️ 服务端专用（含路由插件描述）；浏览器通过 GET /api/plugins 拿视图，不直接 import。
import type { PluginConfigField, PluginScope } from "@/lib/seams/plugins";

/** 与 package.json 的 version 对齐（内置插件的版本号） */
export const BUILTIN_PLUGIN_VERSION = "0.1.0";

export interface PluginCatalogEntry {
  id: string;
  title: string;
  description: string;
  scope: PluginScope;
  version: string;
  /** 核心插件不可禁用：禁掉会让应用起不来或功能全废 */
  core: boolean;
  /** 组合清单里的默认启用状态（缺省 true）；dynamic-plugins 默认关闭 */
  defaultEnabled?: boolean;
  capabilities: readonly string[];
  configFields?: readonly PluginConfigField[];
}

/** 内置插件清单（顺序 = 设置界面展示顺序：核心 → 功能 → 路由 → UI） */
export const PLUGIN_CATALOG: readonly PluginCatalogEntry[] = [
  {
    id: "http-routes",
    title: "HTTP 路由注册表",
    description: "所有 /api 路由插件的贡献点；关掉它整站 API 都会消失。",
    scope: "host",
    version: BUILTIN_PLUGIN_VERSION,
    core: true,
    capabilities: ["httpRoutes"],
  },
  {
    id: "tools-registry",
    title: "AI 工具注册表",
    description: "内置 19 个工具与插件贡献工具的统一注册表。",
    scope: "host",
    version: BUILTIN_PLUGIN_VERSION,
    core: true,
    capabilities: ["tools"],
  },
  {
    id: "settings-file",
    title: "配置层",
    description: "data/settings.json + 环境变量 + 组合默认的三层配置。",
    scope: "host",
    version: BUILTIN_PLUGIN_VERSION,
    core: true,
    capabilities: ["settings"],
  },
  {
    id: "doc-store-sqlite",
    title: "文档存储（SQLite）",
    description: "本地文档读写实现；关掉后所有笔记数据都不可用。",
    scope: "host",
    version: BUILTIN_PLUGIN_VERSION,
    core: true,
    capabilities: ["docStore"],
  },
  {
    id: "plugin-manager",
    title: "插件管理器",
    description: "提供本页的列表/启停/配置/审批能力。",
    scope: "host",
    version: BUILTIN_PLUGIN_VERSION,
    core: true,
    capabilities: ["pluginAdmin"],
  },
  {
    id: "dynamic-plugins",
    title: "AI 动态插件通道",
    description: "允许模型在运行时定义并运行插件（默认关闭）。开启后 AI 会多出 5 个 plugin_* 工具。",
    scope: "host",
    version: BUILTIN_PLUGIN_VERSION,
    core: false,
    defaultEnabled: false,
    capabilities: ["tools", "httpRoutes", "dynamicPlugins"],
  },
  {
    id: "route-health",
    title: "健康检查路由",
    description: "GET /api/health 存活探针（dev 启动等待脚本用，无需鉴权）。",
    scope: "host",
    version: BUILTIN_PLUGIN_VERSION,
    core: false,
    capabilities: ["httpRoutes"],
  },
  {
    id: "route-auth",
    title: "认证路由",
    description: "注册 / 登录 / 注销。",
    scope: "host",
    version: BUILTIN_PLUGIN_VERSION,
    core: false,
    capabilities: ["httpRoutes"],
  },
  {
    id: "route-me",
    title: "当前用户路由",
    description: "GET /api/me 会话恢复。",
    scope: "host",
    version: BUILTIN_PLUGIN_VERSION,
    core: false,
    capabilities: ["httpRoutes"],
  },
  {
    id: "route-documents",
    title: "文档路由",
    description: "文档 CRUD、归档、移动、恢复。",
    scope: "host",
    version: BUILTIN_PLUGIN_VERSION,
    core: false,
    capabilities: ["httpRoutes"],
  },
  {
    id: "route-chat-sessions",
    title: "会话路由",
    description: "AI 会话的创建、重命名、删除与消息读取。",
    scope: "host",
    version: BUILTIN_PLUGIN_VERSION,
    core: false,
    capabilities: ["httpRoutes"],
  },
  {
    id: "route-ai-chat",
    title: "AI 对话路由",
    description: "POST /api/ai/chat 的 SSE 流式入口。",
    scope: "host",
    version: BUILTIN_PLUGIN_VERSION,
    core: false,
    capabilities: ["httpRoutes"],
  },
  {
    id: "route-ai-undo",
    title: "AI 撤销路由",
    description: "按 requestId 预览 / 执行改动回滚。",
    scope: "host",
    version: BUILTIN_PLUGIN_VERSION,
    core: false,
    capabilities: ["httpRoutes"],
  },
  {
    id: "route-upload",
    title: "上传路由",
    description: "图片上传到本地 data/uploads/。",
    scope: "host",
    version: BUILTIN_PLUGIN_VERSION,
    core: false,
    capabilities: ["httpRoutes"],
  },
  {
    id: "route-uploads",
    title: "上传读取路由",
    description: "读取 / 删除已上传文件。",
    scope: "host",
    version: BUILTIN_PLUGIN_VERSION,
    core: false,
    capabilities: ["httpRoutes"],
  },
  {
    id: "route-public-documents",
    title: "公开预览路由",
    description: "无鉴权读取已发布文档。",
    scope: "host",
    version: BUILTIN_PLUGIN_VERSION,
    core: false,
    capabilities: ["httpRoutes"],
  },
  {
    id: "route-plugins",
    title: "插件管理路由",
    description: "GET/PATCH /api/plugins 与动态插件审批（owner-only）。",
    scope: "host",
    version: BUILTIN_PLUGIN_VERSION,
    core: false,
    capabilities: ["httpRoutes"],
  },
  {
    id: "ui-ai-panel",
    title: "AI 助手面板",
    description: "详情栏的 AI 对话面板（关闭后详情栏留空）。",
    scope: "ui",
    version: BUILTIN_PLUGIN_VERSION,
    core: false,
    capabilities: ["uiSlots"],
  },
];

/** 按 id 查元数据 */
export function findCatalogEntry(id: string): PluginCatalogEntry | undefined {
  return PLUGIN_CATALOG.find((entry) => entry.id === id);
}
