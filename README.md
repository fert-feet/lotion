# Lotion — Notion Clone with AI Agent

类 Notion 的笔记应用，基于 Supabase 全栈后端，集成 DeepSeek AI 笔记助手。

## Features

- **Document CRUD**: 创建、编辑、嵌套组织笔记
- **AI Agent**: 侧边栏唤起 AI 助手，支持总结笔记、改进写作、生成新文档
- **Rich Text Editing**: BlockNote 块编辑器，支持图片上传
- **Hierarchical Organization**: 无限层级嵌套文档树
- **User Authentication**: Supabase Auth（邮箱注册登录）
- **Trash Management**: 归档/恢复/永久删除
- **Cover Images & Icons**: 封面图、Emoji 图标
- **Search**: Ctrl+J / Cmd+J 全局搜索
- **Dark Mode**: 跟随系统主题
- **Publish**: 生成公开分享链接

## Tech Stack

- **Frontend**: Next.js 15, React 19, TypeScript
- **Backend**: Supabase (PostgreSQL + Auth + Storage)
- **AI**: DeepSeek V4 Flash (via @ai-sdk/deepseek)
- **Editor**: BlockNote
- **Styling**: Tailwind CSS 4 + shadcn/ui
- **State**: Zustand

## Getting Started

### Prerequisites

- Node.js 18+
- pnpm
- Supabase 项目（免费）

### Quick Start

```bash
# 1. 安装依赖
pnpm install

# 2. 配置环境变量 — 创建 .env.local
NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_xxxxxxxx
DEEPSEEK_API_KEY=sk-xxxxxxxx

# 3. 在 Supabase SQL Editor 执行 supabase/migrations/001_initial_schema.sql

# 4. Supabase 面板开启 Email Auth（关闭邮箱验证）并创建 Storage bucket "lotion"（公开）

# 5. 启动
pnpm dev
```

打开 [http://localhost:3000](http://localhost:3000)，注册账号即可使用。

## Project Structure

```
app/
├── (main)/               # 认证用户主界面
│   ├── _components/       # navigation, editor, ai-panel, document-list, ...
│   └── (routes)/          # /documents/[documentId]
├── (marketing)/           # 着陆页
├── (public)/              # 公开文档预览
├── api/ai/chat/route.ts   # DeepSeek 流式 API
├── login/                 # 登录
├── register/              # 注册
lib/
├── db.ts                  # Supabase 数据库 CRUD 函数
├── supabase/              # SSR 客户端 + middleware
├── ai-prompts.ts          # AI 系统提示词
hooks/                     # Zustand stores + useSupabaseUser
components/                # shadcn/ui + Toolbar + SearchCommand
supabase/migrations/       # SQL DDL（建表 + RLS）
```

## Data Model

`documents` 表（PostgreSQL，RLS 保护）：

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | UUID | 主键 |
| `title` | TEXT | 标题 |
| `userId` | UUID | 所有者（外键 auth.users） |
| `isArchived` | BOOLEAN | 是否归档 |
| `parentDocument` | UUID | 父文档（自引用） |
| `content` | TEXT | BlockNote JSON |
| `coverImage` | TEXT | 封面图 URL |
| `icon` | TEXT | Emoji 图标 |
| `isPublished` | BOOLEAN | 是否公开 |

## Development

```bash
pnpm dev          # Turbopack 开发服务器
pnpm build        # 生产构建
pnpm start        # 运行构建产物
pnpm lint         # ESLint
```

## Deployment

部署到 Vercel：

1. Push 到 GitHub
2. Vercel 导入项目
3. 设置环境变量（同上）
4. Deploy

## License

MIT
