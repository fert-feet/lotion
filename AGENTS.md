# Lotion（本地数据库版）— Notion Clone with AI Agent

基于 Vite + React 的类 Notion 笔记应用，Hono 提供 REST API，集成 DeepSeek AI 笔记助手。

> ⚠️ 本分支（`feature/vite-hono`）是**唯一活跃的开发分支**，也是仓库默认分支：SQLite 本地数据库 +
> 自研 Auth + REST API。前身是 Supabase 网络数据库版（Next.js），该版本已归档为 tag
> `archive/supabase-main`（只读历史基线，**不要**再合入、也不要 cherry-pick 它的 Supabase 相关提交）。
> 详见 [docs/本地数据库版.md](docs/本地数据库版.md)。
>
> 沿革（2026-09 核实）：本地版这条线内部是**线性演进**，不是并行分叉——
> `main` → `feature/local-db` → `feature/vite-hono`。`feature/local-db` 的提交全部是
> `feature/vite-hono` 的祖先，该分支已删除（内容零损失）；`main` 已归档删除，
> 仓库现只有 `feature/vite-hono` 一条分支。

## 项目

- **前端**: Vite 8 + React 19（SPA，react-router 7 路由）
- **后端**: Hono 4 + @hono/node-server（Node 进程同时托管 REST API 与静态资源）
- **数据库**: 本地 SQLite（better-sqlite3，WAL 模式，单机自托管）
- **Auth**: 自研极简（scrypt 哈希 + sessions 表 + HttpOnly cookie，无第三方库）
- **编辑器**: **BlockNote 0.54**（`@blocknote/core` + `@blocknote/react`，默认 UI + 自有 DSH 对齐样式 `components/editor/blocknote.css`）：**BlockNote JSON 无损存储**（保留块 ID）；存量 Markdown / 旧 BlockNote JSON 惰性兼容；服务端 JSON↔Markdown 转换走 `@blocknote/server-util`（`lib/content-server.ts`，⚠️ 仅服务端导入）
- **AI**: @ai-sdk/deepseek (deepseek-flash)
- **状态管理**: Zustand
- **样式**: Tailwind CSS 4 + 自研 UI 原语（`components/ui/`），视觉语言 = **Apple / macOS**（见下「设计系统」）
- **包管理器**: pnpm（⚠️ 包是 ESM，`package.json` 的 `"type": "module"` 不可去掉）

## 命令

```bash
pnpm dev          # 并行启动 vite(5173) + Hono(3001)；/api 由 vite 代理到 Hono
pnpm dev:web      # 只启动前端
pnpm dev:api      # 只启动 API（tsx watch）
pnpm build        # vite 构建客户端到 dist/
pnpm start        # 运行 Hono（托管 dist/ + API），首次请求自动建库 data/lotion.db
pnpm typecheck    # tsc --noEmit
pnpm lint         # ESLint
pnpm test         # Vitest 单测（单次运行）
pnpm test:watch   # Vitest 监听模式
```

## 架构

```
浏览器（React SPA）
   │  fetch /api/*（同源 cookie 鉴权）
   ▼
Hono（server/，Node 进程）
   ├── requireAuth 中间件（会话 cookie → c.get("user")）
   ├── 25 个 REST 端点（server/routes/，路由即插件；含 /api/documents/:id/append、/api/ai/undo）
   ├── 直接调用 lib/local/db.ts（原生 SQLite，无 HTTP 中转）
   └── 静态资源 dist/ + public/ + SPA 回退
```

```
src/
├── main.tsx                # 客户端入口（样式 → App）
├── app.tsx                 # 全局 Provider（Theme / Toaster / Modal / User）
├── router.tsx              # 路由表（导出 routes 供测试用 createMemoryRouter 复用）
├── pages/                  # 页面：marketing / login / register / documents / document / preview / 404 / error
├── shell/                  # 认证区外壳：app-shell / main-layout(守卫) / sidebar / ai-panel / editor / ...
├── marketing/              # 着陆页组件
└── styles/                 # globals.css（Tailwind 4 + 设计 token）+ fonts.css（@fontsource）
server/
├── index.ts                # 入口：createApp + 静态托管 + SPA 回退 + serve
├── app.ts                  # 装配 /api/*（可测试，不监听端口）
├── http.ts                 # AppEnv 类型 / readJson / 统一错误响应
├── middleware.ts           # requireAuth（会话校验）
└── routes/                 # auth / me / documents / chat / ai-chat(SSE) / ai-undo / upload / public-documents
lib/
├── db.ts                   # 客户端数据访问入口：全部走 fetch REST（⚠️ 仅浏览器）
├── local/                  # ⚠️ 服务端专用（禁止客户端导入）
│   ├── sqlite.ts            # 连接单例(WAL) + 启动迁移执行器 + UUID/时间戳工具
│   ├── migrations.ts        # SQLite DDL（users/sessions/documents/chat_sessions/chat_messages/ai_changes）
│   ├── db.ts                # 本地 SQL 实现（与 lib/db.ts 函数一一对应，显式 userId 过滤）
│   ├── auth.ts              # scrypt 哈希 + 会话管理 + cookie 工具
│   ├── request-user.ts      # 从请求 cookie 解析会话用户（中间件调用）
│   └── uploads.ts           # 上传目录解析（UPLOAD_DIR）
├── agent.ts                # Agent 核心：streamText + doom loop 检测 + SSE 事件流包装 + 回合快照/改动前快照
├── chat-snapshot.ts        # 回合快照类型 + 宽容解析（客户端/服务端共享，⚠️ 环境无关）
├── tool-meta.ts            # 工具标签/图标单一真相源（客户端 AI 面板也导入）
├── ai/tools/               # 19 个 Tool（search/list/read/create/update/rename/move/icon/publish/archive/restore/trash/delete/askUser/todoWrite/docInfo/docOutline/docBlocks/updateBlock）+ blocks-util.ts
├── ai-prompts.ts           # AI 系统提示词（领域概念/使用模式/规范/安全）
├── content.ts              # 文档内容适配层·客户端安全部分（isBlockNoteJson/toEditorBlocks/标题提取）
├── content-server.ts       # ⚠️ 服务端专用（禁止客户端导入）：toMarkdown / toBlocks
├── compress.ts             # 上下文压缩（滑动窗口 100 条 + 模型重写式摘要）
└── layout/columns.ts       # 三栏让步链纯函数
hooks/                      # Zustand stores + use-user（含 refreshUser）
components/                 # shadcn/ui + Toolbar + SearchCommand + Upload + editor/
test/                       # Vitest 单测（lib/ / api/ / components/ 同构）
```

- 数据库 6 张表：users / sessions / documents / chat_sessions / chat_messages / ai_changes
  （每次启动自动迁移，当前 4 个迁移；chat_messages.metadata=回合快照，chat_sessions.documentId=会话绑定文档）
- `documents` 自引用（`parentDocument`）支持嵌套；多用户隔离靠**应用层显式 userId 过滤**（无 RLS）
- AI 面板在 `src/shell/ai-panel.tsx`（纯逻辑在 `src/shell/ai/turn-reducer.ts`，有单测），
  details 列常驻、流式渲染；⌘J 开合，窄屏由 shell 渲染成右侧浮层
- AI 回合的三条持久化通道：assistant 消息正文（纯文本回放）、`chat_messages.metadata`
  回合快照（工具卡/副作用卡/引用/待办/提问/耗时/requestId/附件清单）、`ai_changes` 改动前快照（撤销）
- **AI 草稿流程**：建完自动跳转到新文档让用户**查看**（内容在创建时就已写入，不必先保存；
  每轮只跳一次），确认动作在对话栏内完成（`src/shell/ai/note-card.tsx` 的 created 卡片：
  打开看看 / 丢弃 / 确认保存 + 创建位置）；文档页不再有 `DraftBanner`（已删除）。
  刷新后的终态靠"文档事实对账"恢复：文档不在了 = 已丢弃，`isDraft=false` = 已保存
- sidebar 宽度可拖拽（264-420px），可折叠为 56px rail
- 运行时数据：`data/lotion.db`（可用 `LOTION_DB_PATH` 覆盖）、`data/uploads/`（可用 `UPLOAD_DIR` 覆盖），均 gitignore

## 设计系统（Apple / macOS 语言）

`src/styles/globals.css` 是唯一视觉真相源，**组件里不写死颜色**，一律用语义 token：

| 类别 | token | 说明 |
|---|---|---|
| 颜色 | `background` / `card` / `popover` / `secondary` / `muted` | 取 macOS 系统色板，明暗两套独立取值（浅色窗口 `#fff`，深色 `#1e1e1e`、抬升面 `#2c2c2e`） |
| 文本 | `foreground` / `muted-foreground` / `shell-label-secondary` / `shell-label-tertiary` | 对应 macOS 的 label / secondaryLabel / tertiaryLabel |
| 主色 | `primary`（systemBlue `#007AFF` / 暗色 `#0A84FF`） | 交互与选中；AI 品牌黄 `ai` 只用于 AI 元素与荧光笔高亮 `hl` |
| 圆角 | `rounded-[6px]` 控件 / `[10px]` 卡片 / `[14px]` 面板 / `[16px]` 弹窗 | 连续圆角，不用胶囊按钮 |
| 阴影 | `shadow-[var(--shadow-sm|md|lg)]` | 多层柔和投影，禁止重投影 |
| 材质 | `.material-sidebar` / `.material-toolbar` / `.material-popover` | backdrop-blur + 饱和，用于侧边栏/顶栏/浮层 |
| 动效 | `ease-[var(--ds-ease-out)]`、150–200ms | Apple 减速曲线；`active:scale-[0.97]` 给按压反馈 |

排版基线：UI 13px、正文 17px/1.5（编辑器）、大标题 28–32px 且 `tracking-[-0.02em]`；
字体栈优先系统 SF Pro（`--font-ui`），非 Apple 平台回退 Geist。**不要引入衬线展示体。**

## 约定

- **后台代码（lib/、server/）每次修改必须补或更新单测**：新增/修改行为要有对应用例，回归修复要有防复发用例，提交前 `pnpm test` 必须全绿
- 测试文件放 `test/` 目录，与被测模块同构（`test/lib/`、`test/api/`）；SQLite 层用 `:memory:` 真实 SQL（不连外部服务），REST 路由用 `createApp()` + `app.request()`（无需监听端口）+ mock getDb，AI SDK / logger 用 `vi.mock` + fake 桩
- **禁止启动开发服务器**：不要执行 `pnpm dev` 或 `npm run dev`。用户自行管理服务进程。验证编译用静态检查（`pnpm typecheck` + `pnpm lint` + `pnpm build`）即可
- 提交消息格式：`feature: <中文描述>` 或 `fix: <中文描述>`，每次变更必须提交
- **本分支永远独立**：`feature/vite-hono` 是仓库唯一分支兼默认分支；不要合入、也不要 cherry-pick 已归档的 `archive/supabase-main`（Supabase 网络数据库版）相关提交
- 组件默认是客户端组件（SPA，无 RSC）；只有 `server/` 与 `lib/local/`、`lib/content-server.ts` 是服务端代码
- **客户端 / 服务端边界**：`src/`、`components/`、`hooks/` 禁止值导入 `@/lib/local/*`、`@/lib/content-server`、`@/lib/agent`、`better-sqlite3`（type-only 导入允许）——由 `test/boundary.test.ts` 静态守卫（替代 Next 的 `server-only` 包）
- Zustand store 模式：`isOpen / onOpen / onClose / toggle`
- 数据库操作统一通过 `lib/db.ts` 导出函数，不在组件中直接写 SQL/查询
- 图片上传到本地磁盘 `data/uploads/`（**后期换图床**：改 `server/routes/upload.ts`，`{ url }` 契约不变）
- AI 改动的边界：只有**隐式写入**（updateNote/updateBlock/renameNote/setNoteIcon/publishNote/
  archiveNote/restoreNote）进 `ai_changes` 可撤销；用户显式确认过的删除/移动不进（确认框本身
  已是一次确认，永久删除也无法用"恢复字段"表达）
- AI 流协议：`POST /api/ai/chat` 返回 SSE（`text/event-stream`），每行 `data: <json>\n\n`，事件类型 `turn_start / text / tool_start / tool_end / note_created / note_modified / confirm_delete / confirm_move / question / todo_update / reference / warning / turn_end / error`（见 `lib/agent.ts` 的 `AgentStreamEvent`）；前端 `ai-panel.tsx` 按 `\n\n` 分隔解析事件行，**不要改成拼接文本 + 正则提取标记**
- Agent 通信：tool 副作用经注入的 `onEvent` 回调上报（`lib/ai/tools/index.ts` 的 `ToolEvent`），agent 层聚合为事件队列转 SSE，**不要恢复共享可变对象（`pendingNoteId.current` 等）+ 轮询模式**
- 不要在 `messages` 数组中放 `role: "system"`，用 `streamText({ system: "..." })` 参数
- 鉴权：`/api/documents`、`/api/chat`、`/api/ai/chat`、`/api/upload` 全部挂 `requireAuth` 中间件；本地层所有查询显式带 `userId`（无 RLS 兜底）

## 后期 TODO（代码内已注释）

- 图床迁移（`server/routes/upload.ts`）
- 公网部署时 SQLite → 远程 libsql + 公开面重新评估（`server/routes/public-documents.ts`）

## Notes
