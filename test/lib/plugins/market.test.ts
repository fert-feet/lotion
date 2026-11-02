// 市场：本地/远端 registry、bundle 读取、统计、发布、校验和/签名。
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import type { InstalledPluginManifest } from "@/lib/local/plugin-package";
import { createPluginMarket } from "@/lib/local/plugin-market";

let dir: string;
let publicDir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "lotion-market-"));
  publicDir = path.join(dir, "public");
  fs.mkdirSync(path.join(publicDir, "plugin-market"), { recursive: true });
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function writeJson(relative: string, data: unknown) {
  const file = path.join(publicDir, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf-8");
  return file;
}

function entry(overrides: Record<string, unknown> = {}) {
  return {
    id: "a",
    name: "A",
    version: "1.0.0",
    description: "ok",
    bundle: "/plugin-market/a.json",
    ...overrides,
  };
}

function manifest(overrides: Partial<InstalledPluginManifest> = {}): InstalledPluginManifest {
  return {
    id: "published",
    name: "Published",
    version: "1.0.0",
    description: "本地发布",
    tags: ["demo"],
    capabilities: ["tools"],
    config: [],
    enabled: false,
    approved: true,
    configValues: {},
    host: "harness.define({ apply() {} })",
    ...overrides,
  };
}

function market(overrides: Parameters<typeof createPluginMarket>[0] = {}) {
  return createPluginMarket({ publicDir, dataDir: path.join(dir, "data"), ...overrides });
}

describe("createPluginMarket", () => {
  it("读取 registry、过滤非法条目、排序", async () => {
    writeJson("plugin-market/registry.json", {
      entries: [
        entry({ updatedAt: "2026-01-01T00:00:00.000Z" }),
        { id: "bad", name: "Bad" },
        entry({ id: "b", name: "B", updatedAt: "2026-02-01T00:00:00.000Z" }),
      ],
    });

    const list = await market().list();
    expect(list.map((item) => item.id)).toEqual(["b", "a"]);
    expect(list.every((item) => item.source === "local")).toBe(true);
  });

  it("同源 bundle 读取与 sha256；缺失/越界报错", async () => {
    const file = writeJson("plugin-market/a.json", { id: "a", name: "A" });
    const text = fs.readFileSync(file, "utf-8");
    const m = market();

    const bundle = await m.bundle(entry() as never);
    expect(bundle.manifest).toEqual({ id: "a", name: "A" });
    expect(bundle.sha256).toBe(createHash("sha256").update(text).digest("hex"));

    await expect(m.bundle(entry({ bundle: "/../secret.json" }) as never)).rejects.toThrow(/越界/);
    await expect(m.bundle(entry({ bundle: "/plugin-market/missing.json" }) as never)).rejects.toThrow(
      /不存在/,
    );
  });

  it("下载量与评分/评论写入本地 stats 并合并", async () => {
    writeJson("plugin-market/registry.json", { entries: [entry()] });
    writeJson("plugin-market/a.json", { id: "a" });
    const m = market();

    m.recordDownload("a");
    m.rate("a", 5, "很好用");
    m.rate("a", 3, "");
    const list = await m.list();
    expect(list[0].downloads).toBe(1);
    expect(list[0].rating).toBe(4);
    expect(list[0].ratingCount).toBe(2);
    expect(list[0].comments?.[0].text).toBe("很好用");
  });

  it("发布到本地市场后能读回 bundle，并写入 data registry", async () => {
    const m = market();
    const published = m.publish(manifest());
    expect(published).toMatchObject({ id: "published", bundle: "local:published", source: "local" });

    const list = await m.list();
    expect(list.find((item) => item.id === "published")?.capabilities).toEqual(["tools"]);

    const bundle = await m.bundle(published);
    expect((bundle.manifest as { id: string }).id).toBe("published");
    expect(published.sha256).toBe(bundle.sha256);

    // 重复发布是覆盖，不产生重复条目
    m.publish(manifest({ version: "1.1.0" }));
    expect((await m.list()).filter((item) => item.id === "published")).toHaveLength(1);
  });

  it("远端 registry：HTTPS 抓取并合并，失败时回退本地", async () => {
    writeJson("plugin-market/registry.json", { entries: [entry()] });
    writeJson("plugin-market/a.json", { id: "a" });
    const calls: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("registry.json")) {
        return new Response(
          JSON.stringify({ entries: [entry({ id: "remote", name: "Remote", bundle: "https://cdn.example/remote.json" })] }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ id: "remote", name: "Remote" }), { status: 200 });
    }) as typeof fetch;

    const m = market({
      registryUrl: () => "https://market.example/registry.json",
      fetchImpl,
    });
    const list = await m.list();
    expect(list.find((item) => item.id === "remote")?.source).toBe("remote");
    expect(list.find((item) => item.id === "a")).toBeDefined();
    expect(calls.some((url) => url.includes("registry.json"))).toBe(true);
  });

  it("校验和不匹配会拒绝安装", async () => {
    writeJson("plugin-market/a.json", { id: "a" });
    const m = market();
    await expect(
      m.bundle(entry({ sha256: "deadbeef" }) as never),
    ).rejects.toThrow(/校验和不匹配/);
  });

  it("Ed25519 签名验证；强制造价时未签名拒绝", async () => {
    const file = writeJson("plugin-market/a.json", { id: "a" });
    const text = fs.readFileSync(file, "utf-8");
    const sha = createHash("sha256").update(text).digest("hex");
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const signature = sign(null, Buffer.from(sha, "hex"), privateKey).toString("base64");
    const pem = publicKey.export({ type: "spki", format: "pem" }).toString();

    const previous = process.env.LOTION_MARKET_PUBLIC_KEY;
    process.env.LOTION_MARKET_PUBLIC_KEY = pem;
    try {
      const signed = market({ requireSignature: () => true });
      await expect(signed.bundle(entry({ sha256: sha, signature }) as never)).resolves.toBeTruthy();
      await expect(signed.bundle(entry({ sha256: sha }) as never)).rejects.toThrow(/未签名/);
      await expect(
        signed.bundle(entry({ sha256: sha, signature: "bad" }) as never),
      ).rejects.toThrow(/签名校验失败/);
    } finally {
      if (previous === undefined) delete process.env.LOTION_MARKET_PUBLIC_KEY;
      else process.env.LOTION_MARKET_PUBLIC_KEY = previous;
    }
  });

  it("source() 返回远端/验签配置", () => {
    const m = market({
      registryUrl: () => "https://market.example/registry.json",
      requireSignature: () => true,
    });
    expect(m.source()).toEqual({
      url: "https://market.example/registry.json",
      remote: true,
      requireSignature: true,
    });
  });
});
