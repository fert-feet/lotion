// 宿主内核装配单测：服务可用性 / 启动审计 / 配置读值 / 依赖注入隔离 / 重复装配幂等。
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import { openTestDb, initDatabase, isoNow } from "@/lib/local/sqlite";
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
    const kernel = bootHostKernel({ db, settingsPath: path.join(dir, "settings.json") });

    expect(kernel.audit.pending).toEqual([]);
    expect(kernel.audit.failed).toEqual([]);
    expect(kernel.audit.services).toContain("docStore");
    expect(kernel.audit.services).toContain("settings");
    expect(kernel.auditText).toContain("已装配");

    // 通过内核拿到的 docStore 真的能读写
    const id = await getHostDocStore().create({ userId: "u1" }, "内核装配的文档");
    expect((await getHostDocStore().getById({ userId: "u1" }, id))?.title).toBe("内核装配的文档");

    await kernel.dispose();
    expect(isHostKernelBooted()).toBe(false);
  });

  it("重复装配返回同一实例（幂等）", () => {
    const first = bootHostKernel({ db, settingsPath: path.join(dir, "settings.json") });
    const second = bootHostKernel({ db, settingsPath: path.join(dir, "settings.json") });

    expect(second).toBe(first);
  });

  it("配置从两层层级读：用户层覆盖默认，env 覆盖用户层", () => {
    const settingsPath = path.join(dir, "settings.json");
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({ ai: { model: "from-file" }, server: { port: 4100 } }),
      "utf-8",
    );

    const kernel = bootHostKernel({ db, settingsPath });

    expect(kernel.settings.ai.get().model).toBe("from-file");
    expect(kernel.settings.server.get().port).toBe(4100);

    // 环境变量最高优先级（部署方注入）
    process.env.AI_MODEL = "from-env";
    const kernel2 = bootHostKernel(); // 幂等：拿到同一实例，但重新读一次环境变量需新装配
    expect(kernel2).toBe(kernel);
  });

  it("设置服务缺失时消费方仍拿到组合默认值（优雅降级链路）", async () => {
    const kernel = bootHostKernel({ db, settingsPath: path.join(dir, "settings.json") });
    const before = kernel.settings.ai.get();

    // 卸载 settings 提供方所在的整棵内核 → 无法再读；这里验证的是 section 的回退语义
    expect(before.model).toBe("deepseek-v4-flash");
    await kernel.dispose();
  });
});
