# Lotion（本地数据库版）— Notion Clone with AI Agent

基于 Next.js 的类 Notion 笔记应用，集成 DeepSeek AI 笔记助手。

> ⚠️ 本分支（feature/local-db）是**永久独立的本地单机版**：SQLite 本地数据库 + 自研 Auth + REST API，
> **永不合并回 main**（main 是 Supabase 网络数据库版）。两线各自演进，
> 详见 [docs/本地数据库版.md](docs/本地数据库版.md)。

## 项目

- **框架**: Next.js 15.5.4 (App Router, Turbopack)
- **后端**: 本地 SQLite（better-sqlite3，WAL 模式，单机自托管）
- **Auth**: 自研极简（scrypt 哈希 + sessions 表 + HttpOnly cookie，无第三方库）
- **编辑器**: BlockNote 0.41
- **AI**: @ai-sdk/deepseek (deepseek-v4-flash)
- **状态管理**: Zustand
- **样式**: Tailwind CSS 4 + shadcn/ui
- **包管理器**: pnpm

## 命令

```bash
pnpm dev          # 启动开发服务器 (turbopack)；首次请求自动建库 data/lotion.db
pnpm build        # 生产构建
pnpm start        # 运行构建产物（单机自托管）
pnpm lint         # ESLint
pnpm test         # Vitest 单测（单次运行）
pnpm test:watch   # Vitest 监听模式
```

## 架构

```
app/
├── (main)/               # 认证用户主界面（layout.tsx 服务端守卫：会话 cookie 校验）
│   ├── _components/       # navigation, document-list, editor, ai-panel, ...
│   └── (routes)/documents/[documentId]/   # 文档编辑页
├── (marketing)/           # 公开着陆页
├── (public)/(routes)/preview/[documentId]/  # 公开预览（无鉴权，仅已发布文档）
├── api/
│   ├── ai/chat/route.ts   # DeepSeek 流式 API（SSE）
│   ├── auth/              # register / login / logout + /api/me
│   ├── documents/         # 文档 CRUD / 归档 / 恢复（REST，session 鉴权）
│   ├── chat/sessions/     # AI 会话与消息（REST，session 鉴权）
│   ├── upload/            # 图片上传（本地磁盘，见 TODO 图床）
│   ├── uploads/[filename] # 图片读取/删除
│   └── public/documents/  # 公开预览端点（无鉴权，仅 isPublished）
├── login/page.tsx          # 本地 Auth 登录
└── register/page.tsx       # 本地 Auth 注册
lib/
├── db.ts                   # 数据访问统一入口：server 直查 SQLite / client fetch REST（环境分派）
├── local/                  # ⚠️ 服务端专用（禁止客户端导入）
│   ├── sqlite.ts            # 连接单例(WAL) + 启动迁移执行器 + UUID/时间戳工具
│   ├── migrations.ts        # SQLite DDL（users/sessions/documents/chat_sessions/chat_messages）
│   ├── db.ts                # 本地 SQL 实现（与 lib/db.ts 函数一一对应，显式 userId 过滤）
│   ├── auth.ts              # scrypt 哈希 + 会话管理 + cookie 工具
│   └── request-user.ts      # REST 路由公共鉴权入口
├── agent.ts                # Agent 核心：streamText + SSE 事件流包装（6 类事件）
├── ai/tools/               # 7 个 Tool（search/read/create/update/rename/archive/delete）
├── ai-prompts.ts           # AI 系统提示词
├── compress.ts             # 上下文压缩（滑动窗口 100 条 + 模型重写式摘要）
hooks/                      # Zustand stores + use-user
components/                 # shadcn/ui + Toolbar + SearchCommand + Upload
test/                       # Vitest 单测（与 lib/、api/ 同构目录）
vitest.config.mts           # Vitest 配置（node 环境 + @/ alias）
```

- 数据库 5 张表：users / sessions / documents / chat_sessions / chat_messages（每次启动自动迁移）
- `documents` 自引用（`parentDocument`）支持嵌套；多用户隔离靠**应用层显式 userId 过滤**（无 RLS）
- AI 面板在 `(main)/_components/ai-panel.tsx`，右侧滑出，流式渲染
- sidebar 宽度可拖拽调整（240-480px），移动端可折叠
- 运行时数据：`data/lotion.db`（可用 `LOTION_DB_PATH` 覆盖）、`data/uploads/`（可用 `UPLOAD_DIR` 覆盖），均 gitignore

## 约定

- **后台代码（lib/、app/api/）每次修改必须补或更新单测**：新增/修改行为要有对应用例，回归修复要有防复发用例，提交前 `pnpm test` 必须全绿
- 测试文件放 `test/` 目录，与被测模块同构（`test/lib/`、`test/api/`）；SQLite 层用 `:memory:` 真实 SQL（不连外部服务），REST 路由用真实 handler + mock getDb，AI SDK / logger 用 `vi.mock` + fake 桩
- **禁止启动开发服务器**：不要执行 `pnpm dev` 或 `npm run dev`。用户自行管理服务进程。验证编译用静态检查（`npx tsc --noEmit` + `pnpm lint`）即可
- 提交消息格式：`feature: <中文描述>` 或 `fix: <中文描述>`，每次变更必须提交
- **本分支永远独立**：不要合并 main，不要 cherry-pick main 的 Supabase 相关提交
- 所有组件目前都是 `"use client"`（项目尚未使用 React Server Components）
- Zustand store 模式：`isOpen / onOpen / onClose / toggle`
- 数据库操作统一通过 `lib/db.ts` 导出函数，不在组件中直接写 SQL/查询；`lib/local/*` 只允许服务端导入（better-sqlite3 是原生模块，进客户端打包会报错）
- 图片上传到本地磁盘 `data/uploads/`（**后期换图床**：改 `app/api/upload/route.ts`，`{ url }` 契约不变）
- AI 流协议：`POST /api/ai/chat` 返回 SSE（`text/event-stream`），每行 `data: <json>\n\n`，事件类型 `text / progress / note_created / confirm_delete / note_modified / references / error`（见 `lib/agent.ts` 的 `AgentStreamEvent`）；前端 `ai-panel.tsx` 按 `\n\n` 分隔解析事件行，**不要改成拼接文本 + 正则提取标记**
- Agent 通信：tool 副作用经注入的 `onEvent` 回调上报（`lib/ai/tools/index.ts` 的 `ToolEvent`），agent 层聚合为事件队列转 SSE，**不要恢复共享可变对象（`pendingNoteId.current` 等）+ 轮询模式**
- 不要在 `messages` 数组中放 `role: "system"`，用 `streamText({ system: "..." })` 参数
- 鉴权：所有 REST 路由先 `userFromRequest(request)`（401 拦截）；本地层所有查询显式带 `userId`（无 RLS 兜底）

## 后期 TODO（代码内已注释）

- 图床迁移（`app/api/upload/route.ts`）
- Vercel 部署时 SQLite → 远程 libsql + 公开面重新评估（`app/api/public/documents/`）

## Notes
