# Lotion — AI 笔记（本地单机版）

<p align="center">
  <img src="./assets/readme/hero.svg?v=3" width="100%" alt="Lotion：全栈 AI 笔记应用——DSH 风格三栏布局、无限层级文档树、BlockNote 富文本编辑，DeepSeek Agent 通过 SSE 事件流实时管理笔记">
</p>

> 本分支（`feature/local-db`）是**永久独立的本地单机版**：SQLite 本地数据库 + 自研 Auth + REST API，**永不合并回 main**（main 是 Supabase 网络数据库版）。详见 [docs/本地数据库版.md](docs/本地数据库版.md)。

全栈 AI 笔记应用：**SQLite 本地数据库**存储，**BlockNote** 负责富文本编辑，**DeepSeek Agent** 帮你搜索、创建、修改和整理笔记。前端采用 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 同款三栏 shell 侧边栏设计。

## 特性

- **DSH 风格三栏布局** — `sidebar | center | details` 可拖拽三栏（侧边栏 264-420px、AI 面板 300-520px），侧边栏可折叠成 56px 图标 rail，窄屏自动折叠；让步链保证中心列不被挤压
- **无限层级文档树** — `parentDocument` 自引用嵌套，任意深度组织笔记；行高 32px、hover 浮现「新建子笔记 / 更多」操作与相对时间
- **BlockNote 富文本编辑** — 图片上传、封面图、Emoji 图标，内容实时保存
- **DeepSeek Agent** — 7 个 Tool 自主决策（搜索/读取/创建/更新/重命名/归档/删除），SSE 事件流实时推送每一步进度；AI 面板为常驻 details 列，关闭不丢状态
- **内嵌搜索胶囊** — 侧边栏头部点击展开全宽输入框，即时过滤文档树；`Cmd/Ctrl + J` 全局命令面板
- **回收站与草稿** — 归档/恢复/永久删除（支持批量）；AI 新建笔记默认进入确认制草稿
- **发布预览** — 一键发布生成公开链接（无鉴权端点仅吐已发布文档，单机语义）

## 它如何工作

用户输入经过 `/api/ai/chat` 进入 Agent 循环：`streamText` 驱动 DeepSeek 自主调用工具，工具副作用经 `onEvent` 回调上报事件队列，再以 SSE 事件流逐条推送给前端：

```
用户 prompt → POST /api/ai/chat → streamText({ model: AI_MODEL, tools: 7 个, stopWhen: 5 步 })
  → AI 调用 Tool（search/read/create/update/rename/archive/delete）
  → onEvent 上报副作用（创建 / 修改 / 删除确认 / 引用）
  → SSE 事件行 data: <json> → 前端解析 → 跳转 / 刷新 / 确认 / 进度展示
```

| 事件类型 | 含义 |
|----------|------|
| `text` | AI 回复文本流 |
| `progress` | 工具执行进度 |
| `note_created` | 已创建草稿，等待用户确认 |
| `confirm_delete` | 请求确认删除 |
| `note_modified` | 笔记已被修改 |
| `references` | 关联笔记引用 |
| `error` | 生成中途出错（模型 API 异常等） |

## 快速开始

### 前置要求

- Node.js 18+ 与 pnpm
- DeepSeek API Key（可选，仅 AI 功能需要）

### 安装

```bash
# 1. 安装依赖
pnpm install

# 2. 配置环境变量 — 创建 .env.local
DEEPSEEK_API_KEY=sk-xxxxxxxx

# 3. 启动（首个请求自动建库 data/lotion.db，无需手动跑 SQL）
pnpm dev
```

打开 [http://localhost:3000](http://localhost:3000)，注册账号即可使用。

## 项目结构

```
app/
├── (main)/                       # 认证用户主界面（layout.tsx 服务端会话守卫）
│   ├── _components/
│   │   ├── app-shell.tsx         # DSH 风格三栏 shell（sidebar|center|details + 拖拽手柄）
│   │   ├── sidebar/              # 侧边栏：header 搜索胶囊 / 文档树 / 底部图标栏 / rail
│   │   ├── ai-panel.tsx          # AI 面板（details 列常驻挂载，SSE 流式渲染）
│   │   ├── editor.tsx / navbar.tsx / cover.tsx / ...
│   └── (routes)/documents/[documentId]/   # 文档编辑页
├── (marketing)/                  # 公开着陆页
├── (public)/(routes)/preview/[documentId]/  # 公开预览（无鉴权，仅已发布）
├── api/                          # auth / documents / chat / ai/chat(SSE) / upload / public
├── login/ + register/            # 本地 Auth
lib/
├── db.ts                         # 数据访问分派：server 直查 SQLite / client fetch REST
├── layout/columns.ts             # 三栏让步链纯函数（常量 + computeColumns）
├── agent.ts                      # Agent 核心：streamText + SSE 事件流包装
├── ai/tools/                     # 7 个 Agent Tool
├── local/                        # ⚠️ 服务端专用：sqlite / migrations / db / auth / request-user
hooks/use-layout.ts               # 布局 store（sidebar/details 宽度、窄屏、toggle）
components/                       # shadcn/ui + SearchCommand + Upload
test/                            # Vitest 单测（与 lib/、api/ 同构）
```

## 数据模型（SQLite 5 张表）

`users` / `sessions` / `documents` / `chat_sessions` / `chat_messages`，每次启动自动迁移（`lib/local/migrations.ts` 内嵌 DDL + `_migrations` 记录表）。

`documents` 表（应用层显式 `userId` 过滤，无 RLS）：

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | TEXT PK | 应用层 `crypto.randomUUID()` |
| `userId` | TEXT FK | 所有者 |
| `title` | TEXT | 标题 |
| `isArchived` | INTEGER | 软删除标记（0/1） |
| `isDraft` | INTEGER | AI 创建草稿，需确认 |
| `parentDocument` | TEXT FK | 父文档（自引用嵌套） |
| `content` | TEXT | BlockNote JSON 块 |
| `coverImage` / `icon` | TEXT | 封面图 / Emoji 图标 |
| `isPublished` | INTEGER | 是否公开 |
| `createdAt` / `updatedAt` | TEXT | ISO 8601（应用层显式更新） |

## 开发

```bash
pnpm dev          # Turbopack 开发服务器（禁止在本仓库内由 agent 启动）
pnpm build        # 生产构建
pnpm start        # 运行构建产物（单机自托管）
pnpm lint         # ESLint
pnpm test         # Vitest 单测（173 个用例，内存 SQLite + 真实 REST handler）
npx tsc --noEmit  # 类型检查
```

## 部署

单机自托管：`pnpm build && pnpm start`。数据落在 `data/lotion.db`（可用 `LOTION_DB_PATH` 覆盖）与 `data/uploads/`（可用 `UPLOAD_DIR` 覆盖）。

> ⚠️ TODO（代码内已注释）：图床迁移（`app/api/upload/route.ts`）；上 Vercel 时 SQLite 文件会丢失，需迁远程 libsql 并重新评估公开面（`app/api/public/documents/`）。

## License

MIT
