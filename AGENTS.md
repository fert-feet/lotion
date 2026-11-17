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
>
> 架构已重构为**插件化应用**（内核 + 接缝 + 内置插件），详见 [docs/插件化架构.md](docs/插件化架构.md)——**改动前先读它**。

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

Lotion 是**插件化应用**：核心只提供内核与接缝，功能以插件挂载。内核是**真实
`@deepseek-ai/cordis@4.0.2`**（不是自研），且**全仓库只有 `lib/kernel/cordis.ts` 一处 import 它**——
要在 npm 依赖与 vendor 源码之间切换，只动那一个文件。完整设计（8 条接缝、写插件指南、
动态通道的安全姿态）见 [docs/插件化架构.md](docs/插件化架构.md)，第三方插件格式见
[docs/插件开发.md](docs/插件开发.md)。

```
浏览器（React SPA）                                  Node 进程（Hono）
┌────────────────────────────┐                    ┌────────────────────────────┐
│ client kernel（src/kernel）│                    │ host kernel（server/kernel）│
│  docStore → REST provider  │◄──── /api/* ──────►│  docStore → SQLite provider │
│  uiSlots（插槽注册表）      │  同源 cookie 鉴权   │  settings / tools / httpRoutes│
└────────────────────────────┘                    └────────────────────────────┘
        └──────── 共用同一个 lib/kernel + 共享契约（lib/seams/） ────────┘
```

```
Hono（server/，Node 进程）
   ├── requireAuth 中间件（会话 cookie → c.get("user")）
   ├── 43 个 REST 端点（= 10 个路由插件，清单见 server/routes/index.ts；另 +1 个 opt-in 动态插件路由）
   │     例如 /api/documents/:id/append、/api/ai/undo
   ├── 直接调用 lib/local/db.ts（原生 SQLite，无 HTTP 中转）
   └── 静态资源 dist/ + public/ + SPA 回退
```

**8 条接缝**（`lib/seams/`：契约 + 服务 key + 装配期形状校验；实现分端提供）

| 服务 key | 宿主提供方 | 浏览器提供方 |
|---|---|---|
| `docStore` | `lib/local/doc-store-sqlite.ts` | `lib/client/doc-store-rest.ts` |
| `settings` | `lib/local/settings-file.ts` | — |
| `httpRoutes` | `server/composition.ts` | — |
| `tools` | `server/composition.ts` | — |
| `uiSlots` | — | `src/kernel/client.ts` |
| `remote` | —（宿主侧即 REST 路由） | `lib/client/remote-rest.ts` |
| `dynamicPlugins` | `lib/dynamic/runner.ts`（**默认 disabled**） | `src/dynamic/client-runner.ts` |
| `pluginAdmin` | `lib/local/plugin-manager.ts` | `lib/client/plugin-admin-rest.ts` |

```
src/
├── main.tsx                # 客户端入口（内核装配 → App）
├── app.tsx                 # 全局 Provider（Theme / Toaster / Modal / User）+ KernelProvider
├── router.tsx              # 路由表（导出 routes 供测试用 createMemoryRouter 复用）
├── kernel/                 # 客户端内核装配：client.ts（bootClientKernel）+ react.tsx（useDocStore/useSlot/usePluginAdmin）
├── dynamic/                # 动态插件客户端半边（宿主关闭时为空操作）
├── pages/                  # 页面：marketing / login / register / documents / document / market / 404 / error
├── shell/                  # 认证区外壳：app-shell / main-layout(守卫) / sidebar / ai-panel / editor / ...
│   └── ui-plugins.tsx       # 第三方 UI 插槽常量；内置 UI 插件当前为空，AI 面板直接归 shell
├── marketing/              # 着陆页组件
└── styles/                 # globals.css（Tailwind 4 + 设计 token）+ fonts.css（@fontsource）
server/
├── index.ts                # 入口：loadEnvFiles → bootHostKernel（打印装配审计）→ createApp + 静态托管 + serve
├── kernel.ts               # 宿主内核装配（组合根）
├── composition.ts          # 宿主组合清单（稳定 id + 用户层 patch；dynamic-plugins 默认 disabled）
├── load-env.ts             # .env.local / .env 加载（真实环境变量优先）
├── app.ts                  # 实时分发：按请求查 httpRoutes 注册表装配 /api/*（可测试，不监听端口）
├── http.ts                 # AppEnv（Bindings.kernel / Variables.user）/ readJson / 统一错误响应
├── middleware.ts           # requireAuth（会话校验）
└── routes/                 # 路由插件清单 index.ts + auth / me / documents / chat / ai-chat(SSE) / ai-undo / upload / plugins
lib/
├── kernel/                 # ⚠️ 环境无关纯 TS（禁 node: / React / 服务端模块，由 boundary.test.ts 守卫）
│   ├── cordis.ts            # 唯一 import "@deepseek-ai/cordis" 处：适配层（FiberState 重建/settle/audit）
│   ├── cordis-loader.ts     # 装配层（稳定 id / patch 整块替换 / 单条失败不掀桌 / 逆序卸载）
│   └── index.ts             # 出口
├── seams/                  # 8 条接缝的契约（doc-store / settings / http-routes / ui-slots / tools / remote / dynamic / plugins）
├── client/                 # ⚠️ 浏览器专用：doc-store-rest + remote-rest + plugin-admin-rest
├── dynamic/                # ⚠️ 服务端专用：node:vm 沙箱 + 生命周期 + plugin_* 自指工具（默认关闭）
├── db.ts                   # 客户端数据访问入口：全部走 fetch REST（⚠️ 仅浏览器；UI 层禁止直接 import，走 docStore 接缝）
├── local/                  # ⚠️ 服务端专用（禁止客户端导入）
│   ├── sqlite.ts            # 连接单例(WAL) + 启动迁移执行器 + UUID/时间戳工具
│   ├── migrations.ts        # SQLite DDL（users/sessions/documents/chat_sessions/chat_messages/ai_changes）
│   ├── db.ts                # 本地 SQL 实现（docStore 宿主实现的数据源，显式 userId 过滤）
│   ├── doc-store-sqlite.ts  # docStore 的宿主提供方（包 lib/local/db.ts）
│   ├── settings-file.ts     # settings 提供方（用户层 data/settings.json + 组合默认 + env 三层）
│   ├── lotion-config.ts     # Lotion 配置命名空间（ai / plugins / market / storage / server / logging）
│   ├── auth.ts              # scrypt 哈希 + 会话管理 + cookie 工具
│   ├── request-user.ts      # 从请求 cookie 解析会话用户（中间件调用）
│   ├── uploads.ts           # 上传目录解析（UPLOAD_DIR）
│   ├── owner.ts             # 最早注册用户标记（isOwner，仅展示，不参与插件权限）
│   ├── plugin-catalog.ts    # 内置插件元数据（标题/描述/core/能力）
│   ├── plugin-manager.ts    # pluginAdmin 宿主实现（列表/启停/配置/审批/市场）
│   ├── plugin-package.ts    # 已安装包 manifest + data/plugins/installed 存储
│   ├── plugin-runtime.ts    # 已安装插件宿主半边挂载/卸载
│   ├── plugin-market.ts     # 本地/远端市场（registry / bundle / stats / 发布 / 校验和与验签）
│   ├── dynamic-store.ts     # 动态定义持久化 data/plugins/dynamic
│   └── static-plugin-controller.ts  # 静态插件热挂载（M4）
├── agent.ts                # Agent 核心：streamText + doom loop 检测 + SSE 事件流包装 + 回合快照/改动前快照
├── chat-snapshot.ts        # 回合快照类型 + 宽容解析（客户端/服务端共享，⚠️ 环境无关）
├── tool-meta.ts            # 工具标签/图标单一真相源（客户端 AI 面板也导入）
├── ai/tools/               # 16 个 Tool（search/list/read/create/update/rename/move/icon/manageTrash/delete/askUser/todoWrite/docInfo/docOutline/docBlocks/updateBlock）+ registry.ts（注册表/守卫）+ blocks-util.ts
├── ai/runtime-config.ts    # 每次请求解析模型/Key（走配置层，不读模块顶层 env）
├── ai-prompts.ts           # AI 系统提示词（领域概念/使用模式/规范/安全）
├── blocknote-schema.ts     # 自定义 schema（callout / mention），客户端服务端共享
├── highlight-langs.ts      # 高亮语言单一真相源（零依赖：白名单 + 别名归一，渲染层也导入）
├── highlight-shared.ts     # shiki 高亮器工厂（编辑器与 AI 正文共用 loader/主题表）
├── markdown-highlight.ts   # AI 正文代码块高亮（懒加载 shiki，返回 token 而非 HTML）
├── content.ts              # 文档内容适配层·客户端安全部分（isBlockNoteJson/toEditorBlocks/标题提取）
├── content-server.ts       # ⚠️ 服务端专用（禁止客户端导入）：toMarkdown / toBlocks
├── compress.ts             # 上下文压缩（滑动窗口 100 条 + 模型重写式摘要）
├── logger.ts               # 结构化日志（LOG_LEVEL 走配置层）
└── layout/columns.ts       # 三栏让步链纯函数
hooks/                      # Zustand stores + use-user（含 refreshUser / isOwner）
components/                 # shadcn/ui + Toolbar + SearchCommand + Upload + editor/
│   └── settings/            # 设置弹窗插件页 / 配置弹窗 / 源码预览（市场页在 src/pages/market.tsx）
public/plugin-market/       # 本地市场 registry + 示例 bundle（word-count / daily-quote）
templates/plugin/           # 第三方插件最小模板（复制到 data/plugins/installed）
test/                       # Vitest 单测（lib/ / api/ / components/ / seams/ 同构）
```

- 数据库 7 张表：users / sessions / documents / chat_sessions / chat_messages / ai_changes / document_versions
  （另有 FTS5 虚拟表 `documents_fts`：trigram 分词，触发器同步，供 AI searchNotes 用；`<3` 字回落 LIKE）
  （每次启动自动迁移，当前 7 个迁移；chat_messages.metadata=回合快照，chat_sessions.documentId=会话绑定文档）
- `documents` 自引用（`parentDocument`）支持嵌套；多用户隔离靠**应用层显式 userId 过滤**（无 RLS）
- AI 面板在 `src/shell/ai-panel.tsx`（纯逻辑在 `src/shell/ai/turn-reducer.ts`，有单测），
  是 **shell 内建功能，不是可启停插件**；流式渲染；**只有一种布局** = 三栏停靠（占一列挤压正文），
  ⌘J / Ctrl+J 开合，宽度是
  `useLayout.details` 的拖拽偏好；窗口放不下三栏时让步链把列压成 0 → 降级为右侧浮层 +
  遮罩点击关闭（同一个 React 位置，不重挂载）。**不要**再引入 `docked/overlay/fullscreen`
  这样的呈现模式**或 ⌘⇧J 循环**：同一功能三套行为、用户无法预期，已删除
- AI 回合的三条持久化通道：assistant 消息正文（纯文本回放）、`chat_messages.metadata`
  回合快照（工具卡/副作用卡/引用/待办/提问/耗时/requestId/附件清单）、`ai_changes` 改动前快照（撤销）
- **AI 草稿流程**：建完自动跳转到新文档让用户**查看**（内容在创建时就已写入，不必先保存；
  每轮只跳一次），确认动作在对话栏内完成（`src/shell/ai/note-card.tsx` 的 created 卡片：
  打开看看 / 丢弃 / 确认保存 + 创建位置）；文档页不再有 `DraftBanner`（已删除）。
  刷新后的终态靠"文档事实对账"恢复：文档不在了 = 已丢弃，`isDraft=false` = 已保存
- sidebar 宽度可拖拽（264-420px），可折叠为 56px rail
- sidebar 的 wide / rail / 窄屏抽屉共用**同一个持久实例**（文档、展开状态、收藏、滚动位置不丢，抽屉不重复请求）；
  抽屉在窄屏提升到 Popover Top Layer，并把正文/详情列设为 `inert`；
  文档树用扁平可视行模型，超过 500 行自动虚拟窗口，普通长列表用 `content-visibility`，第 5 层起压缩缩进；
  行菜单支持重命名/收藏/“移动到…”对话框，专用拖拽抓手可改层级
- sidebar 底栏是 `role="toolbar"`：设置/回收站/更多为一组，账户菜单独立成组；批量操作和 `sidebar.footer.action`
  插件动作收进“更多”，原生 focusgroup 不可用时由 `useRovingToolbar` 提供单 Tab 停点与方向键导航
- 批量选择模式是 `aria-multiselectable` 树：头部切换为选择状态，行尾普通操作隐藏，行选择走 `aria-selected`；
  底部是独立工具栏（全选可见 / 已选数量 / 删除确认 / 退出），进入前清空搜索避免混合状态
- 运行时数据：`data/lotion.db`（可用 `LOTION_DB_PATH` 覆盖）、`data/uploads/`（可用 `UPLOAD_DIR` 覆盖）、
  `data/plugins/`（已安装 + AI 动态定义，可用 `LOTION_PLUGINS_DIR` 覆盖）、
  `data/plugin-market/`（发布包 / stats）与 `data/plugin-market.json`（本机市场 registry），均 gitignore
- 插件管理：`pluginAdmin` 接缝 + `data/settings.json` 的 `plugins` patch；**所有登录账号权限一致**
  （设置页插件、侧边栏 `/market`、安装/评分/市场源等均可操作）；静态插件启停走
  `static-plugin-controller`（实时），UI 插件需刷新。市场支持
  本地/远端 registry（`market.registryUrl` / `LOTION_MARKET_URL`）、搜索/分类/排序、上传/发布/导出、
  版本更新、评分评论下载量、sha256 + 可选 Ed25519 验签；见 `docs/插件开发.md`

## 设计系统（Apple / macOS 语言）

`src/styles/globals.css` 是唯一视觉真相源，**组件里不写死颜色**，一律用语义 token：

| 类别 | token | 说明 |
|---|---|---|
| 颜色 | `background` / `card` / `popover` / `secondary` / `muted` | 取 macOS 系统色板，明暗两套独立取值（浅色窗口 `#fff`，深色 `#1e1e1e`、抬升面 `#2c2c2e`） |
| 文本 | `foreground` / `muted-foreground` / `shell-label-secondary` / `shell-label-tertiary` | 对应 macOS 的 label / secondaryLabel / tertiaryLabel |
| 主色 | `primary`（systemBlue `#007AFF` / 暗色 `#0A84FF`） | 交互与选中；AI 品牌黄 `ai` 只用于 AI 元素与荧光笔高亮 `hl` |
| 字级 | `text-caption` 11 / `text-ui-sm` 12 / `text-ui` 13 / `text-lead` 15 / `text-body` 17 / `text-title` 22 / `text-display` 32 / `text-hero` 44 | 8 档阶梯，相邻至少差 2px；层级靠字号 + 字重共同表达。**禁止 `text-[13px]`** |
| 圆角 | `rounded-control` 6 / `rounded-card` 10 / `rounded-panel` 14 / `rounded-sheet` 16 | 只增不复用；**不要再覆盖** Tailwind 的 `--radius-sm/md/lg`（覆盖过会导致 shadcn 派生组件圆角漂移）。不用胶囊按钮 |
| 阴影 | `shadow-elevation-1` / `-2` / `-3` | 三层柔和投影（值取 `--shadow-sm/md/lg`，明暗各自一套），禁止重投影与裸 `shadow-md` |
| 发丝线 | `hairline` / `hairline-t` / `-b` / `-l` / `-r` | 0.5px 在 1x 屏会被舍入成 0 或 1px，token 内已含 `max-resolution` 回退。**禁止手写 `border-[0.5px]`** |
| 层级 | `z-chrome` 20 / `z-modal` 9980 / `z-popover` 9990 / `z-toast` 9999 | popover 高于 modal 是故意的：浮层要能盖在弹窗之上。**禁止 `z-[99999]`** |
| 材质 | `.material-sidebar` / `.material-toolbar` / `.material-popover` | backdrop-blur + 饱和，用于侧边栏/顶栏/浮层 |
| 动效 | `ease-[var(--ds-ease-out)]`、150–200ms | Apple 减速曲线；`active:scale-[0.97]` 给按压反馈 |

排版基线：UI `text-ui`（13px）、正文 `text-body`（17px/1.5，编辑器）、大标题 `text-display`/`text-hero` 且 `tracking-[-0.02em]`；
字体栈优先系统 SF Pro（`--font-ui`），非 Apple 平台回退 Geist。**不要引入衬线展示体。**

以上纪律由 `test/components/design-system.test.ts` 静态守卫：任意值、裸 `shadow-md`、`z-[99999]` 一律报错；
AI 面板的语义色另由 `test/components/ai/design-tokens.test.ts` 守卫。**该守卫只扫 `.ts/.tsx`**，
纯 CSS（如 AI 正文 `components/markdown/markdown.css`）走自己的守卫
`test/components/markdown/markdown-css.test.ts`（字号/圆角/动效/关键骨架），新增样式文件时记得补一份。

## 约定

- **后台代码（lib/、server/）每次修改必须补或更新单测**：新增/修改行为要有对应用例，回归修复要有防复发用例，提交前 `pnpm test` 必须全绿
- 测试文件放 `test/` 目录，与被测模块同构（`test/lib/`、`test/api/`）；SQLite 层用 `:memory:` 真实 SQL（不连外部服务），REST 路由用 `createApp()` + `app.request()`（无需监听端口）+ mock getDb，AI SDK / logger 用 `vi.mock` + fake 桩
- **禁止启动开发服务器**：不要执行 `pnpm dev` 或 `npm run dev`。用户自行管理服务进程。验证编译用静态检查（`pnpm typecheck` + `pnpm lint` + `pnpm build`）即可
- 提交消息格式：`feature: <中文描述>` / `fix: <中文描述>` / `docs: <中文描述>`（纯文档改动）；其余按需用 `refactor:` / `style:` / `perf:` / `test:` / `chore:`。每次变更必须提交
- **本分支永远独立**：`feature/vite-hono` 是仓库唯一分支兼默认分支；不要合入、也不要 cherry-pick 已归档的 `archive/supabase-main`（Supabase 网络数据库版）相关提交
- 组件默认是客户端组件（SPA，无 RSC）；服务端专用代码 = `server/`、`lib/local/`、`lib/dynamic/`、`lib/seams/` 的 `http-routes|tools|dynamic`、`lib/content-server.ts`、`lib/agent.ts`、`lib/compress.ts`、`lib/ai/**`
- **客户端 / 服务端边界**（由 `test/boundary.test.ts` 静态守卫，替代 Next 的 `server-only` 包）：
  `src/`、`components/`、`hooks/`、`lib/client/` 禁止**值导入**服务端模块
  （`@/lib/local/*`、`@/lib/content-server`、`@/lib/agent`、`@/lib/compress`、`@/lib/ai/*`、
  `@/lib/dynamic/*`、`@/lib/seams/{http-routes,tools,dynamic}`、`better-sqlite3`、
  `@blocknote/server-util`、`node:*`）；type-only 导入允许
- **UI 层禁止直接 import `@/lib/db`**：一律走内核 `docStore` 接缝（`useDocStore()` / `useActor()`），
  不在组件里直接写 SQL 或 fetch —— 由 `test/boundary.test.ts` 守卫
- **内核必须环境无关**：`lib/kernel/` 禁止 `node:*`、React、服务端模块（两个进程共用同一份）
- **插件化约定**：新增能力 = 写本体 +（要贡献接口才）在 `lib/seams/` 加契约
  + 在 `server/composition.ts`（宿主）加**一行带稳定 id 的清单** + 补单测。路由走
  `server/routes/index.ts`，AI 工具走 `registerTool(ctx, requireTools(ctx), {...})`；
  第三方 UI 走 `requireUiSlots(ctx).register({ id, slot, kind: "single" | "list", component })`。
  **第三方插件的入口/容器归插件所有**：shell 里的按钮、快捷键、列容器要用 `useHasSlot(slot)` 门控，
  否则“禁用插件”只会变成“内容为空”。AI 面板例外：它是内建功能，由 AppShell 直接渲染，
  不要重新改成插件或用 `details.panel` 插槽门控。
- **插件管理**：管理写操作走 `pluginAdmin` 接缝（`usePluginAdmin()`），不要在组件里直接 fetch；
  新增路由贡献用 `registerRoute`（`ctx.effect` 配对注销），否则热切换会留下孤儿路由；
  插件权限对所有登录账号一致（`isOwner` 仅展示，不再参与鉴权）
- **每个注册都要有 disposer**（工具/监听器/服务/effect 都要可逆）；⚠️ Cordis 的 `ctx.effect` 是
  “立即执行并返回 disposer”，只在卸载时执行请写 `ctx.effect(() => () => cleanup())`
- **装配是异步的**：`ctx.plugin()` 只启动加载（state=LOADING），必须 `await settle(fiber)` /
  `await settleAll(ctx)`；`FiberState` 是 `export const enum`（运行时被擦除，由适配层重建）。
  语义差异全部钉在 `test/lib/kernel/cordis-spike.test.ts`
- Zustand store 模式：`isOpen / onOpen / onClose / toggle`
- 图片上传到本地磁盘 `data/uploads/`（**后期换图床**：改 `server/routes/upload.ts`，`{ url }` 契约不变）
- AI 改动的边界：只有**隐式写入**（updateNote/updateBlock/renameNote/setNoteIcon/
  archiveNote/restoreNote）进 `ai_changes` 可撤销；用户显式确认过的删除/移动不进（确认框本身
  已是一次确认，永久删除也无法用"恢复字段"表达）
- AI 流协议：`POST /api/ai/chat` 返回 SSE（`text/event-stream`），每行 `data: <json>\n\n`，事件类型 `turn_start / text / tool_start / tool_end / note_created / note_modified / confirm_delete / confirm_move / question / todo_update / reference / warning / turn_end / error`（见 `lib/agent.ts` 的 `AgentStreamEvent`）；前端 `ai-panel.tsx` 按 `\n\n` 分隔解析事件行，**不要改成拼接文本 + 正则提取标记**
- Agent 通信：tool 副作用经注入的 `onEvent` 回调上报（`lib/ai/tools/index.ts` 的 `ToolEvent`），agent 层聚合为事件队列转 SSE，**不要恢复共享可变对象（`pendingNoteId.current` 等）+ 轮询模式**
- 不要在 `messages` 数组中放 `role: "system"`，用 `streamText({ system: "..." })` 参数
- 鉴权：`/api/documents`、`/api/chat`、`/api/ai/chat`、`/api/upload` 全部挂 `requireAuth` 中间件；本地层所有查询显式带 `userId`（无 RLS 兜底）

## 后期 TODO（代码内已注释）

- 图床迁移（`server/routes/upload.ts`）
- 公网部署时 SQLite → 远程 libsql（本地单机语义的多用户/多端假设需要重新评估）

## Notes

- 验证一次改动：`pnpm typecheck && pnpm lint && pnpm test && pnpm build`（**不要**起 dev server）
- 改测试规模时记得同步文档里的用例数——README、`docs/本地数据库版.md`、`docs/插件化架构.md`
  都写了数字，历史上这三处曾长期互相打架（584 / 461 / 282）。改动后直接跑 `pnpm test` 看汇总行
- 插件化重构的完整设计、Cordis 五处语义差异、动态通道的安全姿态：见 [docs/插件化架构.md](docs/插件化架构.md)
