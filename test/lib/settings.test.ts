// 两层配置层级单测：组合默认 / 用户层覆盖 / 环境变量优先 / 坏配置优雅降级 / 脱敏 / 无服务回退。
// 这些语义是照搬 DSH packages/settings 的行为，也是"AK 只读进程启动那一刻"那类坑的正解。
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { Context, createRootContext, audit, settleAll } from "@/lib/kernel";
import { mount } from "@/test/mocks/mount";
import {
  SETTINGS_SERVICE,
  installSettingsSection,
  isSecretField,
  maskSecret,
  provideSettings,
  requireSettings,
  findSettings,
} from "@/lib/seams/settings";
import { createSettingsFileProvider, resolveSettingsPath, settingsFilePlugin } from "@/lib/local/settings-file";

const aiSchema = z.object({
  model: z.string().min(1),
  apiKey: z.string().default(""),
  temperature: z.number().min(0).max(2).default(1),
});
type AiConfig = z.infer<typeof aiSchema>;

const baseAi: AiConfig = { model: "deepseek-v4-flash", apiKey: "", temperature: 1 };

let dir: string;
let filePath: string;

/** 写入用户层配置文件 */
function writeUserLayer(content: unknown) {
  fs.writeFileSync(filePath, JSON.stringify(content, null, 2), "utf-8");
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "lotion-settings-"));
  filePath = path.join(dir, "settings.json");
  delete process.env.LOTION_TEST_AI_KEY;
  delete process.env.LOTION_TEST_AI_MODEL;
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe("lib/seams/settings 脱敏", () => {
  it("按字段名判定 secret，并给出掩码（保留首尾便于辨认）", async () => {
    expect(isSecretField("apiKey")).toBe(true);
    expect(isSecretField("openaiToken")).toBe(true);
    expect(isSecretField("password")).toBe(true);
    expect(isSecretField("model")).toBe(false);

    expect(maskSecret("sk-lotion-test-key-0000")).toBe("sk-7****19a3");
    expect(maskSecret("short")).toBe("****");
    expect(maskSecret(undefined)).toBe("");
  });
});

describe("lib/local/settings-file 两层合并", () => {
  it("没有用户层时用组合默认值", async () => {
    const provider = createSettingsFileProvider({ filePath });
    const section = provider.register("ai", aiSchema, { base: baseAi });

    expect(section.get()).toEqual(baseAi);
  });

  it("用户层覆盖组合默认值（且未覆盖字段保留默认）", async () => {
    writeUserLayer({ ai: { model: "deepseek-chat", temperature: 0.5 } });
    const provider = createSettingsFileProvider({ filePath });
    const section = provider.register("ai", aiSchema, { base: baseAi });

    expect(section.get()).toEqual({ model: "deepseek-chat", apiKey: "", temperature: 0.5 });
  });

  it("环境变量优先级最高，覆盖用户层与组合层", async () => {
    writeUserLayer({ ai: { model: "from-file" } });
    process.env.LOTION_TEST_AI_MODEL = "from-env";
    const provider = createSettingsFileProvider({ filePath });
    const section = provider.register("ai", aiSchema, {
      base: baseAi,
      env: { model: "LOTION_TEST_AI_MODEL", apiKey: "LOTION_TEST_AI_KEY" },
    });

    expect(section.get().model).toBe("from-env");

    // 空字符串视为未设置（不覆盖）
    process.env.LOTION_TEST_AI_KEY = "";
    expect(section.get().apiKey).toBe("");
  });

  it("用户层写坏时**不炸进程**：退回 base+env 并保留 env 生效", async () => {
    writeUserLayer({ ai: { temperature: "hot" } }); // 类型非法
    process.env.LOTION_TEST_AI_MODEL = "from-env";
    const provider = createSettingsFileProvider({ filePath });
    const section = provider.register("ai", aiSchema, {
      base: baseAi,
      env: { model: "LOTION_TEST_AI_MODEL" },
    });

    expect(section.get()).toEqual({ model: "from-env", apiKey: "", temperature: 1 });
  });

  it("配置文件整体损坏（非 JSON / 非对象）时退回组合默认", async () => {
    fs.writeFileSync(filePath, "{ 这不是 JSON", "utf-8");
    const provider = createSettingsFileProvider({ filePath });
    const section = provider.register("ai", aiSchema, { base: baseAi });

    expect(section.get()).toEqual(baseAi);
  });

  it("set() 写入用户层并通知监听者；描述接口对 secret 字段脱敏", async () => {
    const provider = createSettingsFileProvider({ filePath });
    const section = provider.register("ai", aiSchema, { base: baseAi });
    const seen: AiConfig[] = [];
    section.onChange((value) => seen.push(value));

    await section.set({ apiKey: "sk-lotion-test-key-0000", temperature: 1.5 });

    expect(seen).toHaveLength(1);
    expect(seen[0].apiKey).toBe("sk-lotion-test-key-0000");
    // 落盘为明文（本地单机版语义），但 describe 输出必须脱敏
    const onDisk = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    expect(onDisk.ai.apiKey).toContain("sk-786be");

    const [info] = provider.describe();
    expect(info.namespace).toBe("ai");
    expect(info.value.apiKey).toBe("sk-7****19a3");
    expect(info.value.model).toBe("deepseek-v4-flash");
  });

  it("一个命名空间一个所有者：重复注册抛错", async () => {
    const provider = createSettingsFileProvider({ filePath });
    provider.register("ai", aiSchema, { base: baseAi });

    expect(() => provider.register("ai", aiSchema, { base: baseAi })).toThrow(/已被注册/);
  });

  it("resolveSettingsPath 默认落在 data/settings.json，可被环境变量覆盖", async () => {
    const original = process.env.LOTION_SETTINGS_PATH;
    delete process.env.LOTION_SETTINGS_PATH;
    expect(resolveSettingsPath()).toBe(path.join(process.cwd(), "data", "settings.json"));

    process.env.LOTION_SETTINGS_PATH = "/tmp/custom-settings.json";
    expect(resolveSettingsPath()).toBe("/tmp/custom-settings.json");
    if (original === undefined) delete process.env.LOTION_SETTINGS_PATH;
    else process.env.LOTION_SETTINGS_PATH = original;
  });
});

describe("lib/seams/settings installSettingsSection（消费方视角）", () => {
  it("**没有 settings 服务也照常工作**：先用组合默认，服务出现后自动切换到两层值", async () => {
    const ctx = createRootContext();
    const section = installSettingsSection(ctx, "ai", aiSchema, baseAi);
    await settleAll(ctx);

    expect(section.get()).toEqual(baseAi);
    expect(findSettings(ctx)).toBeUndefined();

    // 挂载 settings 提供方 → 立即接入两层合并值
    writeUserLayer({ ai: { model: "deepseek-chat" } });
    await mount(ctx, { name: "settings-file", apply: (c: Context) => provideSettings(c, createSettingsFileProvider({ filePath })) });

    expect(section.get().model).toBe("deepseek-chat");
  });

  it("settings 服务消失时回退到组合默认（而不是抛错或继续用陈旧值）", async () => {
    const ctx = createRootContext();
    const section = installSettingsSection(ctx, "ai", aiSchema, baseAi);
    await settleAll(ctx);
    writeUserLayer({ ai: { model: "deepseek-chat" } });
    const fiber = await mount(ctx, {
      name: "settings-file",
      apply: (c: Context) => provideSettings(c, createSettingsFileProvider({ filePath })),
    });
    expect(section.get().model).toBe("deepseek-chat");

    await fiber.dispose();

    expect(section.get()).toEqual(baseAi);
  });

  it("set() 经消费方句柄写盘并广播", async () => {
    const ctx = createRootContext();
    await mount(ctx, {
      name: "settings-file",
      apply: (c: Context) => provideSettings(c, createSettingsFileProvider({ filePath })),
    });
    const section = installSettingsSection(ctx, "ai", aiSchema, baseAi);
    await settleAll(ctx);

    await section.set({ temperature: 0.2 });

    expect(section.get().temperature).toBe(0.2);
    expect(JSON.parse(fs.readFileSync(filePath, "utf-8")).ai.temperature).toBe(0.2);
  });

  it("无 settings 服务时 set() 明确失败（写操作不能假装成功）", async () => {
    const ctx = createRootContext();
    const section = installSettingsSection(ctx, "ai", aiSchema, baseAi);
    await settleAll(ctx);

    await expect(section.set({ temperature: 0.2 })).rejects.toThrow(/settings 服务未装配/);
  });

  it("requireSettings 在未装配时给出可操作错误", async () => {
    const ctx = createRootContext();
    expect(() => requireSettings(ctx)).toThrow(/settings 未装配/);
    expect(audit(ctx).services).not.toContain(SETTINGS_SERVICE);
  });

  it("settingsFilePlugin 可用注入路径挂载（组合清单用法）", async () => {
    writeUserLayer({ ai: { model: "from-file" } });
    const ctx = createRootContext();
    await mount(ctx, settingsFilePlugin, { filePath });

    expect(findSettings(ctx)).toBeDefined();
    const section = installSettingsSection(ctx, "ai", aiSchema, baseAi);
    await settleAll(ctx);

    expect(section.get().model).toBe("from-file");
    expect(requireSettings(ctx).describe()).toEqual([
      { namespace: "ai", value: { model: "from-file", apiKey: "", temperature: 1 } },
    ]);
  });
});
