// Lotion 组合层配置单测：默认值 / 环境变量映射（防与 README 漂移）/ 两层合并 / secret 脱敏。
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Context } from "@/lib/kernel";
import { provideSettings } from "@/lib/seams/settings";
import { createSettingsFileProvider } from "@/lib/local/settings-file";
import {
  installLotionSettings,
  lotionSettingsDefaults,
  serverSettingsSchema,
} from "@/lib/local/lotion-config";

let dir: string;
let filePath: string;
const ENV_KEYS = [
  "DEEPSEEK_API_KEY",
  "AI_MODEL",
  "LOTION_DB_PATH",
  "UPLOAD_DIR",
  "PORT",
  "LOG_LEVEL",
] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "lotion-config-"));
  filePath = path.join(dir, "settings.json");
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("lib/local/lotion-config 组合层默认值", () => {
  it("默认值锚定在 data/ 下，端口 3001，模型 deepseek-v4-flash", () => {
    const defaults = lotionSettingsDefaults("/repo");

    expect(defaults).toEqual({
      ai: { apiKey: "", model: "deepseek-v4-flash" },
      storage: { dbPath: path.join("/repo", "data", "lotion.db"), uploadDir: path.join("/repo", "data", "uploads") },
      server: { port: 3001 },
      logging: { level: "info" },
      plugins: {},
    });
  });

  it("端口接受环境变量的字符串形式（coerce），非法值由 schema 兜底", () => {
    expect(serverSettingsSchema.parse({ port: "4567" })).toEqual({ port: 4567 });
    expect(serverSettingsSchema.safeParse({ port: "not-a-port" }).success).toBe(false);
    expect(serverSettingsSchema.safeParse({ port: 70000 }).success).toBe(false);
  });
});

describe("lib/local/lotion-config 两层合并（端到端）", () => {
  it("无 settings 服务时用组合默认；挂载后 env > 用户层 > 组合层", () => {
    const ctx = Context.createRoot();
    const settings = installLotionSettings(ctx, "/repo");

    // 1) 无服务：组合默认
    expect(settings.ai.get().model).toBe("deepseek-v4-flash");
    expect(settings.server.get().port).toBe(3001);

    // 2) 挂载 settings：用户层覆盖
    fs.writeFileSync(
      filePath,
      JSON.stringify({ ai: { model: "from-file" }, server: { port: 4100 } }),
      "utf-8",
    );
    ctx.plugin({
      name: "settings-file",
      apply: (c) => provideSettings(c, createSettingsFileProvider({ filePath })),
    });
    expect(settings.ai.get().model).toBe("from-file");
    expect(settings.server.get().port).toBe(4100);

    // 3) 环境变量再覆盖用户层（部署方优先级最高）
    process.env.AI_MODEL = "from-env";
    process.env.DEEPSEEK_API_KEY = "sk-lotion-test-key-0000";
    const provider = createSettingsFileProvider({ filePath });
    const ctx2 = Context.createRoot();
    ctx2.plugin({ name: "settings-file", apply: (c) => provideSettings(c, provider) });
    const settings2 = installLotionSettings(ctx2, "/repo");
    expect(settings2.ai.get().model).toBe("from-env");
    expect(settings2.ai.get().apiKey).toBe("sk-lotion-test-key-0000");
  });

  it("环境变量名与 README/docs 约定一致（防漂移）", () => {
    process.env.DEEPSEEK_API_KEY = "sk-test-value-1234";
    process.env.AI_MODEL = "model-from-env";
    process.env.LOTION_DB_PATH = "/tmp/custom.db";
    process.env.UPLOAD_DIR = "/tmp/custom-uploads";
    process.env.PORT = "5005";
    process.env.LOG_LEVEL = "debug";

    const ctx = Context.createRoot();
    ctx.plugin({
      name: "settings-file",
      apply: (c) => provideSettings(c, createSettingsFileProvider({ filePath })),
    });
    const settings = installLotionSettings(ctx, "/repo");

    expect(settings.ai.get()).toEqual({ apiKey: "sk-test-value-1234", model: "model-from-env" });
    expect(settings.storage.get()).toEqual({ dbPath: "/tmp/custom.db", uploadDir: "/tmp/custom-uploads" });
    expect(settings.server.get().port).toBe(5005);
    expect(settings.logging.get().level).toBe("debug");
  });

  it("describe() 对 apiKey 脱敏（配置界面永不明文回显 secret）", () => {
    process.env.DEEPSEEK_API_KEY = "sk-lotion-test-key-0000";
    const ctx = Context.createRoot();
    const provider = createSettingsFileProvider({ filePath });
    ctx.plugin({ name: "settings-file", apply: (c) => provideSettings(c, provider) });
    installLotionSettings(ctx, "/repo");

    const ai = provider.describe().find((item) => item.namespace === "ai");

    expect(ai?.value.apiKey).toBe("sk-7****19a3");
  });
});
