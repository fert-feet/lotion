# Lotion — Notion Clone with AI Agent

类 Notion 的全栈笔记应用，基于 Supabase + DeepSeek，支持无限层级文档树、富文本编辑与 Agent 智能管理。

## Features

- **Agent Tool Call**: AI 助手通过 7 个 Tool 自主决策，可搜索、读写、编辑、归档笔记
- **Agent Loop**: 自研流包装层实现 Tool 执行进度实时推送与超时自愈
- **Rich Text Editing**: BlockNote 块编辑器，支持图片上传、封面图、Emoji 图标
- **Infinite Nesting**: 基于 `parentDocument` 自引用的无限层级文档树
- **Publish & Share**: 一键发布文档生成公开链接，未发布文档 RLS 拦截
- **Trash & Draft**: 归档/恢复/永久删除回收站，AI 生成笔记默认为确认制草稿
- **Global Search**: Ctrl+J / Cmd+J 命令面板，模糊搜索所有笔记
- **Dark Mode**: 跟随系统主题自动切换
- **Performance**: 内存缓存 + 请求去重 + 悬停预加载 + DB 复合索引

## Tech Stack

| 层级 | 技术 |
|------|------|
| 框架 | Next.js 15.5 (App Router + Turbopack) |
| 后端 | Supabase (PostgreSQL + Auth + Storage + RLS) |
| 编辑器 | BlockNote v0.41 |
| AI | DeepSeek V4 Flash (via Vercel AI SDK v7) |
| 样式 | Tailwind CSS v4 + shadcn/ui |
| 状态管理 | Zustand v5 |

## Getting Started

### Prerequisites

- Node.js 18+
- pnpm
- Supabase 项目（免费）
- DeepSeek API Key

### Quick Start

```bash
# 1. 安装依赖
pnpm install

# 2. 配置环境变量 — 创建 .env.local
NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_xxxxxxxx
DEEPSEEK_API_KEY=sk-xxxxxxxx

# 3. 在 Supabase SQL Editor 执行所有迁移文件
#    supabase/migrations/001_initial_schema.sql
#    supabase/migrations/002_add_isDraft.sql
#    supabase/migrations/003_add_performance_indexes.sql

# 4. Supabase 面板：开启 Email Auth（关闭邮箱验证）、创建 Storage bucket "lotion"（公开）

# 5. 启动
pnpm dev
```

打开 [http://localhost:3000](http://localhost:3000)，注册账号即可使用。

## Project Structure

```
app/
├── (main)/                       # 认证用户主界面
│   ├── _components/               # 15 个业务组件（navigation, editor, ai-panel, ...）
│   └── (routes)/documents/        # /documents/[documentId]
├── (marketing)/                   # 着陆页
├── (public)/preview/              # 公开文档预览
├── api/ai/chat/route.ts           # Agent API 端点
├── login/ + register/             # Supabase Auth
lib/
├── db.ts                          # CRUD + 请求去重 + 内存缓存
├── agent.ts                       # Agent 核心：streamText + SSE 事件流包装
├── ai-prompts.ts                  # 系统提示词
├── markdown-to-blocks.ts          # Markdown → BlockNote JSON 转换
├── ai/tools/                      # 7 个 Tool（search/read/create/update/rename/archive/delete）
├── supabase/                      # 三层客户端（client/server/middleware）
hooks/                             # 8 个 Zustand stores
components/                        # shadcn/ui + Toolbar + SearchCommand + Upload
supabase/migrations/               # 3 个 SQL 迁移（建表 + RLS + 索引）
```

## Agent Architecture

```
用户 prompt → POST /api/ai/chat → runNoteAgent()
  → streamText({ model: deepseek-v4-flash, tools: 7 tools, stopWhen: 5 steps })
  → AI 自主决策调用 Tool → 共享变量记录副作用（创建/修改/删除确认/引用）
  → ReadableStream 包装层输出 SSE 事件行（data: <json>）
    text / progress / note_created / confirm_delete / note_modified / references
  → 前端按行解析事件 → 跳转/刷新/确认/进度展示
```

## Data Model

`documents` 表（PostgreSQL，RLS 保护）：

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | UUID PK | gen_random_uuid() |
| `title` | TEXT | 标题 |
| `userId` | UUID FK | 所有者（→ auth.users） |
| `isArchived` | BOOLEAN | 软删除标记 |
| `isDraft` | BOOLEAN | AI 创建草稿，需确认 |
| `parentDocument` | UUID FK | 父文档（自引用嵌套） |
| `content` | TEXT | BlockNote JSON 块 |
| `coverImage` | TEXT | 封面图 URL |
| `icon` | TEXT | Emoji 图标 |
| `isPublished` | BOOLEAN | 是否公开 |
| `createdAt` | TIMESTAMPTZ | 创建时间 |
| `updatedAt` | TIMESTAMPTZ | 更新时间（触发器自动） |

RLS：全部 `auth.uid() = "userId"`（SELECT / INSERT / UPDATE / DELETE）。

## Development

```bash
pnpm dev          # Turbopack 开发服务器
pnpm build        # 生产构建
pnpm start        # 运行构建产物
pnpm lint         # ESLint
```

## Deployment

1. Push 到 GitHub
2. Vercel 导入项目
3. 设置环境变量（NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / DEEPSEEK_API_KEY）
4. 在 Supabase SQL Editor 执行迁移 SQL
5. Deploy

## License

MIT
