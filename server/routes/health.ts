// GET /api/health —— 无鉴权存活探针（dev 启动等待脚本 / 部署健康检查用）
import { Hono } from "hono";
import type { AppEnv } from "../http";

export const healthRoutes = new Hono<AppEnv>();

healthRoutes.get("/", (c) => c.json({ ok: true, service: "lotion" }));
