// 插件管理路由（/api/plugins）。
//
// 权限：**所有登录用户权限一致**，可浏览/安装/更新/评分/上传/发布/审批/启停/卸载/配置市场源。
// 唯一公开端点是 `GET /client-config`（启动期 UI 插件过滤，只回 disabled id）。
// 为什么不在路由层挂 requireAuth 中间件：公开端点与受保护端点共用一个子应用，
// 逐 handler 做登录判定更显式，也避免 Hono 中间件注册顺序的坑。
import { Hono, type Context } from "hono";
import { userFromRequest } from "@/lib/local/request-user";
import { requirePluginAdmin, type PluginAdminService } from "@/lib/seams/plugins";
import { PluginAdminError } from "@/lib/local/plugin-manager";
import { readJson, type AppEnv } from "../http";

export const pluginsRoutes = new Hono<AppEnv>();

const CORE_OR_CONFLICT = 409;

/** 未登录 401；通过返回 null */
function authGuard(c: Context<AppEnv>): Response | null {
  const user = userFromRequest(c.req.raw);
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  return null;
}

function errorResponse(c: Context<AppEnv>, error: unknown): Response {
  if (error instanceof PluginAdminError) {
    const status =
      error.code === "NOT_FOUND"
        ? 404
        : error.code === "CORE_PLUGIN" || error.code === "CONFLICT"
          ? CORE_OR_CONFLICT
          : 400;
    return c.json({ error: error.message, code: error.code }, status);
  }
  console.error("[plugins] 未捕获异常:", error);
  return c.json({ error: "Internal Server Error" }, 500);
}

/** 取内核里的插件管理服务并统一映射错误 */
async function withAdmin(
  c: Context<AppEnv>,
  fn: (admin: PluginAdminService) => Promise<Response>,
): Promise<Response> {
  const kernel = c.env.kernel;
  if (!kernel) return c.json({ error: "插件服务未装配（缺少内核上下文）", code: "NO_KERNEL" }, 503);
  try {
    return await fn(requirePluginAdmin(kernel));
  } catch (error) {
    return errorResponse(c, error);
  }
}

/** 启动期客户端配置：公开（未登录也要能渲染页面），只返回 disabled 的 UI 插件 id */
pluginsRoutes.get("/client-config", (c) =>
  withAdmin(c, async (admin) => c.json(await admin.clientConfig())),
);

/** 已批准的客户端半边：登录用户都能取（不下发 host 代码） */
pluginsRoutes.get("/client-halves", (c) => {
  const user = userFromRequest(c.req.raw);
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  return withAdmin(c, async (admin) => c.json(await admin.clientHalves()));
});

/** 列表：内置 + 已安装 + 动态 */
pluginsRoutes.get("/", (c) => {
  const denied = authGuard(c);
  if (denied) return denied;
  return withAdmin(c, async (admin) => c.json({ plugins: await admin.list() }));
});

/** 市场源：读取 / 修改（所有登录用户） */
pluginsRoutes.get("/market/source", (c) => {
  const denied = authGuard(c);
  if (denied) return denied;
  return withAdmin(c, async (admin) => c.json(await admin.getMarketSource()));
});

pluginsRoutes.patch("/market/source", async (c) => {
  const denied = authGuard(c);
  if (denied) return denied;
  const parsed = await readJson<{ url?: unknown }>(c);
  if (!parsed.ok || typeof parsed.data?.url !== "string") {
    return c.json({ error: "需要字符串字段 url" }, 400);
  }
  return withAdmin(c, async (admin) => c.json(await admin.setMarketSource(parsed.data.url as string)));
});

/** 启停 / 改配置 */
pluginsRoutes.patch("/:id", async (c) => {
  const denied = authGuard(c);
  if (denied) return denied;
  const id = c.req.param("id");
  const parsed = await readJson<{ enabled?: unknown; config?: unknown }>(c);
  if (!parsed.ok) return c.json({ error: "请求体不是合法 JSON" }, 400);
  const body = parsed.data;
  if (typeof body !== "object" || body === null) return c.json({ error: "请求体必须是对象" }, 400);
  if (body.enabled === undefined && body.config === undefined) {
    return c.json({ error: "需要 enabled 或 config 字段" }, 400);
  }
  return withAdmin(c, async (admin) => {
    let info;
    if (body.enabled !== undefined) {
      if (typeof body.enabled !== "boolean") {
        return c.json({ error: "enabled 必须是布尔值" }, 400);
      }
      info = await admin.setEnabled(id, body.enabled);
    }
    if (body.config !== undefined) {
      if (
        typeof body.config !== "object" ||
        body.config === null ||
        Array.isArray(body.config)
      ) {
        return c.json({ error: "config 必须是对象" }, 400);
      }
      info = await admin.setConfig(id, body.config as Record<string, unknown>);
    }
    return c.json(info);
  });
});

/** 批准客户端半边 / 运行 / 停止 */
for (const action of ["approve", "run", "stop"] as const) {
  pluginsRoutes.post(`/:id/${action}`, (c) => {
    const denied = authGuard(c);
    if (denied) return denied;
    const id = c.req.param("id");
    return withAdmin(c, async (admin) => c.json(await admin[action](id)));
  });
}

/** 卸载 / 删除动态定义 */
pluginsRoutes.delete("/:id", async (c) => {
  const denied = authGuard(c);
  if (denied) return denied;
  const id = c.req.param("id");
  return withAdmin(c, async (admin) => {
    await admin.remove(id);
    return c.body(null, 204);
  });
});

/** 源码预览 */
pluginsRoutes.get("/:id/source", (c) => {
  const denied = authGuard(c);
  if (denied) return denied;
  const id = c.req.param("id");
  return withAdmin(c, async (admin) => c.json(await admin.source(id)));
});

/** 市场目录：所有登录用户可浏览 */
pluginsRoutes.get("/market", (c) => {
  const user = userFromRequest(c.req.raw);
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  return withAdmin(c, async (admin) =>
    c.json({ entries: await admin.market(), source: await admin.getMarketSource() }),
  );
});

pluginsRoutes.post("/install", async (c) => {
  const denied = authGuard(c);
  if (denied) return denied;
  const parsed = await readJson<{ id?: unknown }>(c);
  if (!parsed.ok || typeof parsed.data?.id !== "string" || parsed.data.id.trim() === "") {
    return c.json({ error: "需要字符串字段 id" }, 400);
  }
  const id = parsed.data.id.trim();
  return withAdmin(c, async (admin) => c.json(await admin.install(id)));
});

/** 上传/导入插件包（JSON） */
pluginsRoutes.post("/upload", async (c) => {
  const denied = authGuard(c);
  if (denied) return denied;
  const parsed = await readJson<{ bundle?: unknown }>(c);
  if (!parsed.ok || parsed.data?.bundle === undefined) {
    return c.json({ error: "需要 bundle 字段（plugin.json 内容）" }, 400);
  }
  return withAdmin(c, async (admin) => c.json(await admin.installBundle(parsed.data.bundle)));
});

/** 导出已安装插件包 */
pluginsRoutes.get("/:id/export", (c) => {
  const denied = authGuard(c);
  if (denied) return denied;
  const id = c.req.param("id");
  return withAdmin(c, async (admin) => c.json(await admin.exportPlugin(id)));
});

/** 发布到本地市场 */
pluginsRoutes.post("/:id/publish", (c) => {
  const denied = authGuard(c);
  if (denied) return denied;
  const id = c.req.param("id");
  return withAdmin(c, async (admin) => c.json(await admin.publishPlugin(id)));
});

/** 评分/评论 */
pluginsRoutes.post("/:id/rate", async (c) => {
  const denied = authGuard(c);
  if (denied) return denied;
  const id = c.req.param("id");
  const parsed = await readJson<{ rating?: unknown; comment?: unknown }>(c);
  if (!parsed.ok || typeof parsed.data?.rating !== "number") {
    return c.json({ error: "需要数字字段 rating（1–5）" }, 400);
  }
  const { rating, comment } = parsed.data;
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return c.json({ error: "rating 必须是 1–5 的整数" }, 400);
  }
  if (comment !== undefined && typeof comment !== "string") {
    return c.json({ error: "comment 必须是字符串" }, 400);
  }
  return withAdmin(c, async (admin) =>
    c.json(await admin.ratePlugin(id, rating, typeof comment === "string" ? comment : undefined)),
  );
});
