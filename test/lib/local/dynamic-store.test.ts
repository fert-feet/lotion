// 文件持久化：读写/删除、坏文件跳过、id 安全校验。
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DynamicRecord } from "@/lib/seams/dynamic";
import { createFileDynamicPersistence, resolveDynamicDir, resolvePluginsDir } from "@/lib/local/dynamic-store";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "lotion-dynamic-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function record(id = "dyn-1"): DynamicRecord {
  return {
    definition: {
      id,
      title: "日报生成器",
      description: "测试",
      host: "harness.define({ apply() {} })",
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    state: "approved",
    note: "已批准",
  };
}

describe("createFileDynamicPersistence", () => {
  it("save → load → remove 往返", () => {
    const store = createFileDynamicPersistence(dir);
    store.save(record());

    const loaded = store.load();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toMatchObject({ state: "approved", note: "已批准" });
    expect(loaded[0].definition.title).toBe("日报生成器");

    store.remove("dyn-1");
    expect(store.load()).toEqual([]);
    // 幂等删除
    expect(() => store.remove("dyn-1")).not.toThrow();
  });

  it("坏 JSON / 错位文件名 / 非法 id 都被跳过或拒绝", () => {
    fs.writeFileSync(path.join(dir, "dyn-1.json"), "{ not json", "utf-8");
    fs.writeFileSync(
      path.join(dir, "dyn-2.json"),
      JSON.stringify({ ...record("dyn-3"), state: "approved" }),
      "utf-8",
    );
    fs.writeFileSync(
      path.join(dir, "dyn-4.json"),
      JSON.stringify({ definition: { id: "../evil", title: "x", createdAt: "now" }, state: "defined" }),
      "utf-8",
    );

    const store = createFileDynamicPersistence(dir);
    expect(store.load()).toEqual([]);
    expect(() => store.save(record("../evil"))).toThrow(/非法的动态插件 id/);
  });

  it("按 createdAt 排序，并容忍空目录", () => {
    const store = createFileDynamicPersistence(dir);
    store.save({
      definition: { id: "dyn-2", title: "later", createdAt: "2026-02-01T00:00:00.000Z", host: "x" },
      state: "defined",
    });
    store.save({
      definition: { id: "dyn-1", title: "earlier", createdAt: "2026-01-01T00:00:00.000Z", host: "x" },
      state: "defined",
    });

    expect(store.load().map((item) => item.definition.id)).toEqual(["dyn-1", "dyn-2"]);
    expect(createFileDynamicPersistence(path.join(dir, "missing")).load()).toEqual([]);
  });

  it("resolveDynamicDir 支持 LOTION_PLUGINS_DIR 覆盖", () => {
    const previous = process.env.LOTION_PLUGINS_DIR;
    process.env.LOTION_PLUGINS_DIR = "custom-plugins";
    try {
      expect(resolvePluginsDir("/tmp/lotion")).toBe(path.resolve("/tmp/lotion", "custom-plugins"));
      expect(resolveDynamicDir("/tmp/lotion")).toBe(
        path.resolve("/tmp/lotion", "custom-plugins", "dynamic"),
      );
    } finally {
      if (previous === undefined) delete process.env.LOTION_PLUGINS_DIR;
      else process.env.LOTION_PLUGINS_DIR = previous;
    }
  });
});
