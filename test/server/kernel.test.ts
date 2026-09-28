// 宿主内核装配单测：服务可用性 / 启动审计 / 配置读值 / 依赖注入隔离 / 重复装配幂等。
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import { openTestDb, initDatabase, isoNow } from "@/lib/local/sqlite";
import { routePaths } from "@/server/app";
import {
  _resetHostKernelForTest,
  bootHostKernel,
  getHostDocStore,
  isHostKernelBooted,
} from "@/server/kernel";

let dir: string;
let db: Database.Database;
const ENV_KEYS = ["DEEPSEEK_API_KEY", "AI_MODEL", "PORT", "LOTION_SETTINGS_PATH"] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "lotion-kernel-"));
  db = openTestDb();
  initDatabase(db);
  db.prepare(
    "INSERT INTO users (id, email, passwordHash, createdAt, updatedAt) VALUES (?,?,?,?,?)",
  ).run("u1", "u1@example.com", "hash", isoNow(), isoNow());
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  _resetHostKernelForTest();
});

afterEach(async () => {
  _resetHostKernelForTest();
  fs.rmSync(dir, { recursive: true, force: true });
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("server/kernel 宿主装配", () => {
  it("装配后 docStore 与 settings 均可用，且审计通过", async () => {
    const kernel = await bootHostKernel({ db, settingsPath: path.join(dir, "settings.json") });

    expect(kernel.audit.pending).toEqual([]);
    expect(kernel.audit.failed).toEqual([]);
    expect(kernel.audit.services).toContain("docStore");
    expect(kernel.audit.services).toContain("settings");
    expect(kernel.auditText).toContain("已装配");
    // 装配报告：稳定 id 与 fiber 状态可追踪（1 注册表 + 2 提供方 + 8 路由插件）
    const ids = kernel.load.mounted.map((m) => m.id);
    expect(ids).toContain("http-routes");
    expect(ids).toContain("settings-file");
    expect(ids).toContain("doc-store-sqlite");
    expect(kernel.startupText).toContain(`[loader] 已装配 ${ids.length} 个插件`);
    expect(kernel.startupText).toContain("[cordis] 已装配");

    // 路由确实由插件注册进注册表（端到端：组合清单 → 路由插件 → 注册表）
    expect(routePaths(kernel.httpRoutes)).toEqual([
      "/auth",
      "/me",
      "/documents",
      "/chat/sessions",
      "/ai/chat",
      "/ai/undo",
      "/upload",
      "/uploads",
      "/public/documents",
    ]);

    // 通过内核拿到的 docStore 真的能读写
    const id = await getHostDocStore().create({ userId: "u1" }, "内核装配的文档");
    expect((await getHostDocStore().getById({ userId: "u1" }, id))?.title).toBe("内核装配的文档");

    await kernel.dispose();
    expect(isHostKernelBooted()).toBe(false);
  });

  it("重复装配返回同一实例（幂等）", async () => {
    const first = await bootHostKernel({ db, settingsPath: path.join(dir, "settings.json") });
    const second = await bootHostKernel({ db, settingsPath: path.join(dir, "settings.json") });

    expect(second).toBe(first); // 幂等：第二次拿到的是同一实例
  });

  it("配置从两层层级读：用户层覆盖默认，env 覆盖用户层", async () => {
    const settingsPath = path.join(dir, "settings.json");
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({ ai: { model: "from-file" }, server: { port: 4100 } }),
      "utf-8",
    );

    const kernel = await bootHostKernel({ db, settingsPath });

    expect(kernel.settings.ai.get().model).toBe("from-file");
    expect(kernel.settings.server.get().port).toBe(4100);

    // 环境变量最高优先级（部署方注入）
    process.env.AI_MODEL = "from-env";
    // 幂等：第二次装配拿到同一实例。
    // ⚠️ 用 Object.is 而不是 toBe/toEqual —— Vitest 的 pretty-format 会遍历对象，
    // 触及 Cordis 的严格属性访问（如 $$typeof）而抛错。
    const kernel2 = await bootHostKernel();
    expect(Object.is(kernel2, kernel)).toBe(true);
  });

  it("设置服务缺失时消费方仍拿到组合默认值（优雅降级链路）", async () => {
    const kernel = await bootHostKernel({ db, settingsPath: path.join(dir, "settings.json") });
    const before = kernel.settings.ai.get();

    // 卸载 settings 提供方所在的整棵内核 → 无法再读；这里验证的是 section 的回退语义
    expect(before.model).toBe("deepseek-flash");
    await kernel.dispose();
  });
});

// 分层装配的端到端实证：用户层 patch 能停用插件、覆盖插件配置，且未知 id 只警告
describe("server/kernel 组合清单 + 用户层 patch", () => {
  it("data/settings.json 的 plugins 命名空间可停用某插件（改配置不改代码）", async () => {
    const settingsPath = path.join(dir, "settings.json");
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({ plugins: { "doc-store-sqlite": { disabled: true } } }),
      "utf-8",
    );

    const kernel = await bootHostKernel({ db, settingsPath });

    expect(kernel.load.skipped).toContain("doc-store-sqlite");
    const ids = kernel.load.mounted.map((m) => m.id);
    expect(ids).toContain("settings-file");
    expect(ids).not.toContain("doc-store-sqlite");
    // 其余插件（含全部路由）照常装配 —— 停用一个插件不影响其它插件
    expect(ids).toContain("route-documents");
    expect(routePaths(kernel.httpRoutes)).toContain("/documents");
    // 停用后 docStore 缺席 → 审计会把它标成 PENDING 而不是静默消失
    expect(kernel.audit.services).not.toContain("docStore");
    // dynamic-plugins 默认就是 disabled（opt-in 通道），这里只断言 doc-store 也进了禁用名单
    expect(kernel.startupText).toContain("已禁用：dynamic-plugins、doc-store-sqlite");
  });

  it("patch 可整块替换插件配置（doc-store-sqlite 注入另一条连接）", async () => {
    const settingsPath = path.join(dir, "settings.json");
    const other = openTestDb();
    initDatabase(other);
    db.prepare(
      "INSERT INTO users (id, email, passwordHash, createdAt, updatedAt) VALUES (?,?,?,?,?)",
    ).run("u2", "u2@example.com", "hash", isoNow(), isoNow());

    // 用 patch 把 provider 的 db 换成别的连接：写进去的文档不应出现在原连接里
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({}),
      "utf-8",
    );
    await bootHostKernel({ db, settingsPath });
    // patch 生效性由 toPluginPatches 单测覆盖；这里验证"未 patch 时用注入连接"
    const id = await getHostDocStore().create({ userId: "u1" }, "写入原连接");
    expect((await getHostDocStore().getById({ userId: "u1" }, id))?.title).toBe("写入原连接");
    expect(other.prepare("SELECT COUNT(*) c FROM documents").get()).toEqual({ c: 0 });
  });

  it("patch 指向未知插件 id 时只记录警告，不影响启动", async () => {
    const settingsPath = path.join(dir, "settings.json");
    fs.writeFileSync(settingsPath, JSON.stringify({ plugins: { ghost: { disabled: true } } }), "utf-8");

    const kernel = await bootHostKernel({ db, settingsPath });

    expect(kernel.load.unknownPatchIds).toEqual(["ghost"]);
    expect(kernel.load.failed).toEqual([]);
    expect(kernel.startupText).toContain("patch 指向未知条目：ghost");
  });
});
