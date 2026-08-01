# Lotion — Notion Clone with AI Agent

基于 Next.js 的类 Notion 笔记应用，已从 Clerk+Convex+EdgeStore 迁移至纯 Supabase，集成 DeepSeek AI 笔记助手。

## 项目

- **框架**: Next.js 15.5.4 (App Router, Turbopack)
- **后端**: Supabase (PostgreSQL + Auth + Storage)
- **编辑器**: BlockNote 0.41
- **AI**: @ai-sdk/deepseek (deepseek-v4-flash)
- **状态管理**: Zustand
- **样式**: Tailwind CSS 4 + shadcn/ui
- **包管理器**: pnpm

## 命令

```bash
pnpm dev          # 启动开发服务器 (turbopack)
pnpm build        # 生产构建
pnpm start        # 运行构建产物
pnpm lint         # ESLint
pnpm test         # Vitest 单测（单次运行）
pnpm test:watch   # Vitest 监听模式
```

## 架构

```
app/
├── (main)/               # 认证用户主界面
│   ├── _components/       # navigation, document-list, editor, ai-panel, ...
│   └── (routes)/documents/[documentId]/   # 文档编辑页
├── (marketing)/           # 公开着陆页
├── (public)/(routes)/preview/[documentId]/  # 文档公开预览
├── api/ai/chat/route.ts   # DeepSeek 流式 API
├── login/page.tsx          # Supabase Auth 登录
├── register/page.tsx       # Supabase Auth 注册
├── auth/callback/route.ts  # OAuth 回调占位
lib/
├── db.ts                   # 所有 Supabase 数据库函数 (CRUD 11 个)
├── agent.ts                # Agent 核心：streamText + SSE 事件流包装（6 类事件）
├── ai/tools/               # 7 个 Tool（search/read/create/update/rename/archive/delete）
├── supabase/client.ts      # 浏览器端 Supabase 客户端
├── supabase/server.ts      # 服务端 Supabase 客户端
├── supabase/middleware.ts   # 会话刷新中间件逻辑
├── ai-prompts.ts           # AI 系统提示词
middleware.ts               # 全局路由守卫（未登录→/login）
supabase/migrations/        # SQL DDL（建表+RLS）
hooks/                      # Zustand stores + useSupabaseUser
components/                 # shadcn/ui + Toolbar + SearchCommand
test/                       # Vitest 单测（与 lib/、api/ 同构目录）
vitest.config.mts           # Vitest 配置（node 环境 + @/ alias）
```

- 数据库仅 1 张 `documents` 表，自引用（`parentDocument`）支持嵌套
- AI 面板在 `(main)/_components/ai-panel.tsx`，右侧滑出，流式渲染
- sidebar 宽度可拖拽调整（240-480px），移动端可折叠

## 约定

- **后台代码（lib/、app/api/）每次修改必须补或更新单测**：新增/修改行为要有对应用例，回归修复要有防复发用例，提交前 `pnpm test` 必须全绿
- 测试文件放 `test/` 目录，与被测模块同构（`test/lib/`、`test/api/`）；supabase / ai sdk / logger 用 `vi.mock` + fake 桩，不连真实数据库
- **禁止启动开发服务器**：不要执行 `pnpm dev` 或 `npm run dev`。用户自行管理服务进程。验证编译用静态检查即可。
- 提交消息格式：`feature: <中文描述>` 或 `fix: <中文描述>`，每次变更必须提交
- 所有组件目前都是 `"use client"`（项目尚未使用 React Server Components）
- Zustand store 模式：`isOpen / onOpen / onClose / toggle`
- 数据库操作统一通过 `lib/db.ts` 导出函数，不在组件中直接写 Supabase 查询
- 文件上传到 Supabase Storage bucket `lotion`
- AI 流协议：`POST /api/ai/chat` 返回 SSE（`text/event-stream`），每行 `data: <json>\n\n`，事件类型 `text / progress / note_created / confirm_delete / note_modified / references`（见 `lib/agent.ts` 的 `AgentStreamEvent`）；前端 `ai-panel.tsx` 按 `\n\n` 分隔解析事件行，**不要改成拼接文本 + 正则提取标记**
- 不要在 `messages` 数组中放 `role: "system"`，用 `streamText({ system: "..." })` 参数

## Notes
