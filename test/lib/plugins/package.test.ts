// 已安装插件包：manifest 校验、文件存储、路径/id 安全。
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  MAX_CODE_BYTES,
  compareVersions,
  createFilePluginPackageStore,
  resolveInstalledDir,
  validatePluginManifest,
  type InstalledPluginManifest,
} from "@/lib/local/plugin-package";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "lotion-package-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function manifest(overrides: Partial<InstalledPluginManifest> = {}): InstalledPluginManifest {
  return {
    id: "word-count",
    name: "字数统计",
    version: "1.0.0",
    description: "示例",
    tags: [],
    capabilities: ["tools"],
    config: [],
    enabled: false,
    approved: true,
    configValues: {},
    host: "harness.define({ apply() {} })",
    ...overrides,
  };
}

describe("validatePluginManifest", () => {
  it("合法清单补齐默认值", () => {
    const parsed = validatePluginManifest({
      id: "demo-plugin",
      name: "Demo",
      version: "1.0.0",
      host: "harness.define({ apply() {} })",
    });
    expect(parsed).toMatchObject({
      id: "demo-plugin",
      capabilities: [],
      config: [],
      enabled: false,
      approved: false,
      configValues: {},
    });
  });

  it("非法 id / 无代码 / 超大代码都拒绝", () => {
    expect(() => validatePluginManifest(manifest({ id: "../../evil" }))).toThrow(/id/);
    expect(() => validatePluginManifest(manifest({ host: undefined }))).toThrow(/至少要有/);
    expect(() =>
      validatePluginManifest(manifest({ host: "x".repeat(MAX_CODE_BYTES + 1) })),
    ).toThrow(/too big|最大|length/i);
  });

  it("版本比较按数字段（1.10 > 1.9）", () => {
    expect(compareVersions("1.10.0", "1.9.0")).toBe(1);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("2.0.0", "10.0.0")).toBe(-1);
  });
});

describe("createFilePluginPackageStore", () => {
  it("save → list/get → remove", () => {
    const store = createFilePluginPackageStore(dir);
    store.save(manifest());

    expect(store.list().map((item) => item.id)).toEqual(["word-count"]);
    expect(store.get("word-count")?.name).toBe("字数统计");

    store.remove("word-count");
    expect(store.list()).toEqual([]);
    expect(store.get("word-count")).toBeUndefined();
  });

  it("坏文件 / id 与目录名不一致的文件被跳过", () => {
    fs.mkdirSync(path.join(dir, "bad"), { recursive: true });
    fs.writeFileSync(path.join(dir, "bad", "plugin.json"), "{ nope", "utf-8");

    fs.mkdirSync(path.join(dir, "word-count"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "word-count", "plugin.json"),
      JSON.stringify(manifest({ id: "other" })),
      "utf-8",
    );

    expect(createFilePluginPackageStore(dir).list()).toEqual([]);
  });

  it("非法 id 不允许读写（路径穿越防线）", () => {
    const store = createFilePluginPackageStore(dir);
    expect(() => store.save(manifest({ id: "../evil" }))).toThrow();
    expect(() => store.remove("../evil")).toThrow(/非法/);
  });

  it("resolveInstalledDir 跟随 LOTION_PLUGINS_DIR", () => {
    const previous = process.env.LOTION_PLUGINS_DIR;
    process.env.LOTION_PLUGINS_DIR = "custom";
    try {
      expect(resolveInstalledDir("/tmp/lotion")).toBe(
        path.resolve("/tmp/lotion", "custom", "installed"),
      );
    } finally {
      if (previous === undefined) delete process.env.LOTION_PLUGINS_DIR;
      else process.env.LOTION_PLUGINS_DIR = previous;
    }
  });
});
