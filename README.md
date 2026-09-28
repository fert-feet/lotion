# Lotion — AI 笔记（本地单机版）

<p align="center">
  <img src="./assets/readme/hero.svg?v=3" width="100%" alt="Lotion：全栈 AI 笔记应用——DSH 风格三栏布局、无限层级文档树、BlockNote 富文本编辑，DeepSeek Agent 通过 SSE 事件流实时管理笔记">
</p>

> 本分支（`feature/local-db`）是**永久独立的本地单机版**：SQLite 本地数据库 + 自研 Auth + REST API，**永不合并回 main**（main 是 Supabase 网络数据库版）。详见 [docs/本地数据库版.md](docs/本地数据库版.md)。

全栈 AI 笔记应用：**Vite 8 + React 19** 前端 SPA（react-router 7），**Hono 4** 单进程提供 REST API 与静态资源，**SQLite 本地数据库**存储，**BlockNote 0.54** 负责富文本编辑，**DeepSeek Agent**（19 个工具）帮你搜索、创建、修改和整理笔记。界面遵循 **Apple / macOS 视觉语言**：系统色板、半透明材质、SF 字体栈与克制的圆角阴影，明暗双主题完整适配。

## 特性

**布局与组织**

- **Apple 风格三栏布局** — `sidebar | center | details` 可拖拽（侧边栏 264-420px、AI 面板 300-520px），让步链优先保证中心列 ≥ 640px；侧边栏/详情栏为半透明材质（vibrancy），可折叠成 56px 图标 rail，视口 < 1024px 自动折叠
- **macOS 视觉系统** — 系统色板（systemBlue 主色 / 分级 label / 发丝分隔线）、SF 字体栈、连续圆角与多层柔和阴影、Apple 减速曲线；明暗双主题各自独立取值
- **无限层级文档树** — `parentDocument` 自引用嵌套，任意深度组织笔记；32px 行高、hover 浮现「新建子笔记 / 更多」操作与相对时间
- **内嵌搜索胶囊** — 侧边栏头部点击展开全宽输入框，即时过滤文档树；`Cmd/Ctrl + J` 全局命令面板
- **回收站与草稿** — 搜索过滤、单条恢复 / 永久删除（删除需二次确认）；AI 新建笔记默认进入确认制草稿
- **发布预览** — 一键发布生成公开链接并复制到剪贴板（无鉴权端点仅吐已发布文档，单机语义）

**编辑器（BlockNote 0.54，对标 Notion）**

- **BlockNote JSON 无损存储** — 保留块 ID；存量 Markdown 与旧版 BlockNote JSON 惰性兼容，无需手工迁移
- **代码块语法高亮** — shiki（`@blocknote/code-block`），schema 客户端 / 服务端共享
- **斜杠菜单 Notion 式分组** — 基础 / 媒体 / 高级 / 其他，含自定义 Callout 块（点击图标换 emoji）
- **@ 提及文档** — 输入 `@` 搜索当前用户文档并插入胶囊，点击跳转
- **页面大纲 TOC** — 右侧 Outline 面板提取标题层级树，点击定位到对应块
- **页面宽窄切换** — narrow（`max-w-3xl`）/ wide（`max-w-5xl`），localStorage 持久化
- **图片与封面** — 拖拽上传到本地磁盘、封面图、Emoji 图标

**AI Agent**

- **19 个工具自主决策** — 检索 / 写入 / 组织 / 交互四类（见下），SSE 事件流实时推送每一步进度
- **流式事件协议** — 14 种事件类型，前端按事件行解析（非拼接文本 + 正则提取）
- **Doom loop 检测** — 相同工具 + 参数连续失败 3 次警告、5 次中止（对齐 SiYuan）
- **上下文压缩** — 滑动窗口保留最近 100 条消息原文（注入最近 N 条），滑出部分由模型重写式摘要（`lib/compress.ts`）
- **常驻 AI 面板** — details 列常驻挂载，关闭不丢状态；⌘J / Ctrl+J 开合，窄屏自动变右侧浮层
- **回合快照** — 每轮的工具卡 / 副作用卡 / 引用 / 待办 / 提问 / 耗时随 assistant 消息落库
  （`chat_messages.metadata`），刷新或切换会话后时间线完整重建（不再只剩一段纯文本）
- **AI 改动可撤销** — 写类工具执行前先拍文档快照（`ai_changes` 表），回合操作条的
  「撤销本次改动」把标题/正文/图标/发布态等恢复回去（幂等、可跨多篇文档）
- **附件上下文** — 可附加 .md/.txt/.json/.csv 等文本文件（单文件 20k 字符、单轮最多 3 个），
  内容当轮拼进 prompt，清单落在用户消息上（刷新后仍看得到附了什么）
- **当前文档上下文** — 提问自动带上正在查看的文档，说"这篇 / 它"无需再 @
- **会话绑定文档** — 新建会话自动绑定当前文档，历史列表可切换「全部会话 / 只看本文档」
- **建完即跳转查看，确认在对话里** — AI 新建笔记后自动切到该文档让用户查看内容（无需先保存），
  对话卡片同时给出「打开看看 / 丢弃 / 确认保存」与**创建位置**；文档页不再有确认横幅（`DraftBanner` 已移除）

## 它如何工作

用户输入经过 `/api/ai/chat` 进入 Agent 循环：`streamText` 驱动 DeepSeek 自主调用工具，工具副作用经 `onEvent` 回调上报事件队列，再以 SSE 事件流逐条推送给前端：

```
用户 prompt → POST /api/ai/chat → streamText({ model: AI_MODEL, tools: 19 个, stopWhen: stepCountIs(5) })
  → AI 调用 Tool（search/list/read/create/update/rename/move/icon/publish/archive/restore/trash/delete/
                  askUser/todoWrite/docInfo/docOutline/docBlocks/updateBlock）
  → onEvent 上报副作用（创建 / 修改 / 删除确认 / 移动确认 / 提问 / 待办 / 引用）
  → SSE 事件行 data: <json> → 前端解析 → 跳转 / 刷新 / 确认 / 进度展示
  → onFinish 落库 assistant 消息 + 回合快照；写类工具执行前落库"改动前快照"（撤销用）
```

| 事件类型 | 含义 |
|----------|------|
| `turn_start` | 一轮 Agent 循环开始（轮次 + 起始时间） |
| `text` | AI 回复文本流 |
| `tool_start` | 工具开始执行（名称 / 序号 / 标签 / 参数） |
| `tool_end` | 工具执行结束（成功与否 + 摘要） |
| `note_created` | 已创建笔记（草稿 + 创建位置；前端自动跳转查看，确认保存/丢弃在对话卡片里完成） |
| `note_modified` | 笔记已被修改 |
| `confirm_delete` | 请求确认永久删除 |
| `confirm_move` | 请求确认移动笔记 |
| `question` | 向用户提出结构化问题（`askUser`） |
| `todo_update` | 多步任务清单更新（`todoWrite`） |
| `reference` | 关联笔记引用 |
| `warning` | doom loop 重复失败警告 |
| `turn_end` | 一轮结束（耗时 + token 统计） |
| `error` | 生成中途出错（模型 API 异常等） |

### Agent 工具（19 个）

| 类别 | 工具 |
|------|------|
| 检索 | `searchNotes` `listNotes` `readNote` `getDocInfo` `getDocOutline` `getDocBlocks` |
| 写入 | `createNote` `updateNote` `renameNote` `moveNote` `setNoteIcon` `updateBlock` |
| 组织 | `publishNote` `archiveNote` `restoreNote` `listTrash` `deleteNote` |
| 交互 | `askUser` `todoWrite` |

## 快速开始

### 前置要求

- **Node.js 22+** 与 pnpm（`better-sqlite3` 要求 Node ≥ 22）
- DeepSeek API Key（可选，仅 AI 功能需要）

### 安装

```bash
# 1. 安装依赖
pnpm install

# 2. 配置环境变量 — 创建 .env.local
DEEPSEEK_API_KEY=sk-xxxxxxxx
# 可选：覆盖模型，默认 deepseek-flash（AI 对话与上下文压缩共用）
# AI_MODEL=deepseek-flash
# 说明：.env.local / .env 由服务端入口 server/load-env.ts 加载（tsx/node 不会自动读，
#       启动日志会打印「已加载 env：…」；缺 key 时启动即打 ⚠️ 提示）。真实环境变量优先于文件。

# 3. 启动（并行起 vite 5173 + Hono 3001；首个请求自动建库 data/lotion.db）
pnpm dev
```

打开 [http://localhost:5173](http://localhost:5173)，注册账号即可使用。

生产模式：`pnpm build && pnpm start` → 单进程同时提供 API 与静态资源（[http://localhost:3001](http://localhost:3001)）。

### 配置有两层（env > data/settings.json > 组合默认）

```json
{
  "ai": { "model": "deepseek-chat" },
  "server": { "port": 3100 },
  "plugins": { "dynamic-plugins": { "disabled": false } }
}
```

- `ai` / `storage` / `server` / `logging`：改完 **无需重启** 即生效（AI 模型与 Key 每次请求解析）
- `plugins`：**装配 patch**，按插件 id 覆盖配置或停用插件（清单见 `server/composition.ts`、`src/shell/ui-plugins.tsx`）
- `dynamic-plugins` 是**默认关闭**的 opt-in 通道（让 AI 现场写插件并热挂载）。开启前请先读
  [`docs/插件化架构.md`](docs/插件化架构.md) 的「安全姿态」表 —— 它**不是沙箱边界**（宿主半边与本机 shell 同级信任，客户端半边需人工审批）。

架构总览、服务/接缝一览、以及「写一个插件要改哪些文件」见 [`docs/插件化架构.md`](docs/插件化架构.md) 附录 A。

## 项目结构

```
src/
├── main.tsx                      # 客户端入口
├── app.tsx                       # 全局 Provider（Theme / Toaster / Modal / User）
├── router.tsx                    # 路由表（导出 routes 供测试复用）
├── pages/                        # marketing / login / register / documents / document / preview / 404 / error
├── shell/                        # 认证区外壳
│   ├── main-layout.tsx           # 会话守卫 + AppShell
│   ├── app-shell.tsx             # DSH 风格三栏 shell（sidebar|center|details + 拖拽手柄）
│   ├── sidebar/                  # 侧边栏：header 搜索胶囊 / 文档树 / footer / rail
│   ├── ai-panel.tsx + ai/        # AI 面板（details 列常驻，SSE 流式渲染）
│   ├── turn-reducer.ts       # 事件→turn / 历史重建 / 队列（纯逻辑，单测覆盖）
│   ├── session-menu.tsx      # 历史会话（搜索 / 重命名 / 只看本文档）
│   └── attachments.ts        # 文本附件读取与校验
│   ├── editor.tsx                # BlockNote 入口（schema / 斜杠菜单 / @提及 / 图片上传）
│   └── title.tsx / cover.tsx / navbar.tsx / publish.tsx / draft-banner.tsx / trash-box.tsx
├── marketing/                    # 着陆页组件
└── styles/                       # globals.css（Tailwind 4 设计 token）+ fonts.css
server/
├── index.ts                      # 入口：静态托管 + SPA 回退 + serve
├── app.ts                        # 装配 /api/*（可测试，不监听端口）
├── middleware.ts                 # requireAuth（会话 cookie 校验）
└── routes/                       # auth / me / documents(+archive|move|restore) / chat / ai-chat(SSE)
│                                 #   / upload + uploads / public-documents
components/
├── editor/                       # blocknote.css / lotion-suggestion-menu.tsx / outline-panel.tsx
├── markdown/                     # AI 回复的流式 Markdown 渲染
├── ui/ + icons/ + modals/ + upload/ + search-command.tsx
hooks/                            # use-layout / use-page-width / use-user / use-refresh / ...
lib/
├── db.ts                         # 客户端数据访问入口（全部 fetch REST）
├── local/                        # ⚠️ 服务端专用：sqlite / migrations / db / auth / request-user / uploads
├── content.ts                    # 客户端安全的内容适配（isBlockNoteJson / toEditorBlocks）
├── content-server.ts             # ⚠️ 服务端专用：JSON ↔ Markdown（@blocknote/server-util）
├── blocknote-schema.ts           # 自定义 schema（callout / mention），客户端服务端共享
├── agent.ts                      # Agent 核心：streamText + doom loop + 回合快照 + 改动前快照（撤销）
├── ai/tools/                     # 19 个 Agent Tool（+ blocks-util.ts 块 JSON 展平/取文本）
├── chat-snapshot.ts              # 回合快照类型与宽容解析（客户端/服务端共享）
├── tool-meta.ts                  # 工具标签/图标单一真相源（客户端也导入）
├── ai-prompts.ts / compress.ts   # 系统提示词 / 上下文压缩
└── layout/columns.ts             # 三栏让步链纯函数（常量 + computeColumns）
test/                             # Vitest 单测（与 lib/、server/ 同构，584 个用例）
```

## 数据模型（SQLite 6 张表）

`users` / `sessions` / `documents` / `chat_sessions` / `chat_messages` / `ai_changes`，每次启动自动迁移（`lib/local/migrations.ts` 内嵌 DDL + `_migrations` 记录表，当前 4 个迁移）。

- `chat_messages.metadata`：assistant 消息的**回合快照**（工具卡/副作用卡/引用/待办/提问/警告/耗时/requestId）与 user 消息的**附件清单**
- `chat_sessions.documentId`：会话绑定的文档（可空 = 全局会话；文档删除时置空）
- `ai_changes`：每轮 AI 写入前的文档快照（按 `requestId` 分组，撤销的原料）

`documents` 表（应用层显式 `userId` 过滤，无 RLS；`userId` / `parentDocument` 上建索引）：

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | TEXT PK | 应用层 `crypto.randomUUID()` |
| `userId` | TEXT FK | 所有者 |
| `title` | TEXT | 标题 |
| `isArchived` | INTEGER | 软删除标记（0/1） |
| `isDraft` | INTEGER | AI 创建草稿，需确认 |
| `parentDocument` | TEXT FK | 父文档（自引用嵌套，`ON DELETE SET NULL`） |
| `content` | TEXT | BlockNote JSON 块 |
| `coverImage` / `icon` | TEXT | 封面图 / Emoji 图标 |
| `isPublished` | INTEGER | 是否公开 |
| `createdAt` / `updatedAt` | TEXT | ISO 8601（应用层显式更新） |

## 开发

```bash
pnpm dev          # vite(5173) + Hono(3001)，/api 代理到 Hono（禁止由 agent 在本仓库内启动）
pnpm build        # vite 构建客户端到 dist/
pnpm start        # 运行 Hono（托管 dist/ + API，单机自托管）
pnpm typecheck    # tsc --noEmit
pnpm lint         # ESLint
pnpm test         # Vitest 单测（584 个用例，内存 SQLite + Hono app.request）
pnpm test:watch   # Vitest 监听模式
```

约定：后台代码（`lib/`、`server/`）每次修改必须补或更新单测，提交前 `pnpm test` 必须全绿；提交消息格式 `feature: <中文描述>` / `fix: <中文描述>`。

## 部署

单机自托管：`pnpm build && pnpm start`。数据落在 `data/lotion.db`（可用 `LOTION_DB_PATH` 覆盖）与 `data/uploads/`（可用 `UPLOAD_DIR` 覆盖）。

> ⚠️ TODO（代码内已注释）：图床迁移（`server/routes/upload.ts`，`{ url }` 契约不变）；公网部署时 SQLite 文件需迁远程 libsql，并重新评估公开面（`server/routes/public-documents.ts`）。

## License

MIT
