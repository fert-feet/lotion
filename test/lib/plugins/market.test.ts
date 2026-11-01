// 本地市场：registry 解析、bundle 读取、路径穿越防线。
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createFilePluginMarket } from "@/lib/local/plugin-market";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "lotion-market-"));
  fs.mkdirSync(path.join(dir, "plugin-market"), { recursive: true });
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function writeBundle(name: string, data: unknown) {
  fs.writeFileSync(path.join(dir, "plugin-market", name), JSON.stringify(data), "utf-8");
}

describe("createFilePluginMarket", () => {
  it("读取 registry 并过滤形状不合法的条目", async () => {
    fs.writeFileSync(
      path.join(dir, "plugin-market", "registry.json"),
      JSON.stringify({
        entries: [
          { id: "a", name: "A", version: "1.0.0", description: "ok", bundle: "/plugin-market/a.json" },
          { id: "bad", name: "Bad" },
        ],
      }),
      "utf-8",
    );

    const market = createFilePluginMarket({ publicDir: dir });
    expect(await market.list()).toEqual([
      { id: "a", name: "A", version: "1.0.0", description: "ok", bundle: "/plugin-market/a.json" },
    ]);
  });

  it("bundle 读取同源 JSON；越界/缺失都报错", async () => {
    writeBundle("a.json", { id: "a" });
    const market = createFilePluginMarket({
      publicDir: dir,
      registryPath: path.join(dir, "plugin-market", "registry.json"),
    });

    expect(await market.bundle("/plugin-market/a.json")).toEqual({ id: "a" });
    await expect(market.bundle("/../secret.json")).rejects.toThrow(/越界/);
    await expect(market.bundle("/plugin-market/missing.json")).rejects.toThrow(/不存在/);
    await expect(market.bundle("https://evil.example/x.json")).rejects.toThrow(/同源/);
  });

  it("registry 缺失时返回空清单", async () => {
    const market = createFilePluginMarket({ publicDir: dir });
    expect(await market.list()).toEqual([]);
  });
});
