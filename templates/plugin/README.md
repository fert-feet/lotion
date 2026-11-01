# 插件模板

一个最小可安装插件：宿主半边贡献 `hello_plugin` 工具，客户端半边在侧边栏底部加一个 👋 按钮。

## 使用

```bash
mkdir -p data/plugins/installed/hello-plugin
cp templates/plugin/plugin.json data/plugins/installed/hello-plugin/plugin.json
```

然后：

1. 重启 `pnpm start`（或重新启动你的 API 进程）；
2. 打开设置 → 插件 → 启用「Hello 插件（模板）」；
3. 有客户端半边时点「批准客户端半边」，刷新页面；
4. 侧边栏底部出现 👋，AI 也多了一个 `hello_plugin` 工具。

## 改什么

- `id`：必须与小写字母/数字/连字符，且目录名一致；
- `host`：`harness.define({ inject: ["tools"], apply(ctx, config) { ... } })`；
- `client`：`harness.define({ apply(ctx) { ctx.get("uiSlots").register(...) } })`，
  用 `harness.createElement` 构造元素；
- `capabilities`：用到哪个服务就声明哪个（`tools` / `httpRoutes` / `ui`）；
- `config`：设置页据此生成表单，值通过 `apply(ctx, config)` 读取。

完整 API、能力矩阵与安全边界见 [docs/插件开发.md](../../docs/插件开发.md)。
