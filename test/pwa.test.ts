// PWA 落地守卫（静态检查）：manifest、Service Worker 与注册点要同时在位，
// 且缓存策略不能把 /api 缓存起来（那会让"改完看不到"变成玄学）。
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

describe("PWA", () => {
  it("manifest 存在且可安装（name / start_url / display / icons）", () => {
    const manifest = JSON.parse(read("public/manifest.webmanifest")) as Record<string, unknown>;
    expect(manifest.name).toBeTruthy();
    expect(manifest.start_url).toBeTruthy();
    expect(manifest.display).toBe("standalone");
    expect(Array.isArray(manifest.icons) && (manifest.icons as unknown[]).length > 0).toBe(true);
  });

  it("index.html 挂上 manifest 与主题色（明暗两套）", () => {
    const html = read("index.html");
    expect(html).toContain('rel="manifest"');
    expect(html).toMatch(/name="theme-color"[^>]*media="\(prefers-color-scheme: dark\)"/);
  });

  it("Service Worker：/api 不缓存，导航走外壳回退", () => {
    const sw = read("public/sw.js");
    // API 一律绕过（早期版本把 API 也缓存过，改动后页面不更新）
    expect(sw).toMatch(/pathname\.startsWith\("\/api\/"\)\)\s*return;/);
    // 导航请求有 network-first + index.html 回退
    expect(sw).toContain('request.mode === "navigate"');
    expect(sw).toContain('caches.match("/index.html")');
    // activate 清理旧版本缓存
    expect(sw).toContain("caches.delete");
  });

  it("只在生产构建注册 Service Worker（dev 注册会缓存 dev 产物）", () => {
    const main = read("src/main.tsx");
    expect(main).toContain('import.meta.env.PROD');
    expect(main).toContain('register("/sw.js")');
  });
});
