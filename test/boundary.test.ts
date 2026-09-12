// 客户端 / 服务端边界守卫。
// 背景：Next.js 用 `import "server-only"` 在打包期阻止客户端引入服务端模块；
// 该包在普通 Node（tsx）下会直接抛错，迁移后移除。这里用可测试的静态检查替代：
// 客户端目录不得出现对服务端专用模块的**值导入**（type-only 导入会被擦除，允许）。
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
/** 会被打进浏览器 bundle 的目录 */
const CLIENT_DIRS = ["src", "components", "hooks", "lib/client"];
/** 禁止客户端值导入的服务端模块（better-sqlite3 为原生模块，进客户端必炸） */
const FORBIDDEN = [
  /^@\/lib\/local\//,
  /^@\/lib\/content-server$/,
  /^@\/lib\/agent$/,
  /^@\/lib\/compress$/,
  /^@\/lib\/ai\//,
  /^better-sqlite3$/,
  /^@blocknote\/server-util$/,
  /^@\/lib\/seams\/http-routes$/,
  /^@\/lib\/dynamic\//,
  /^@\/lib\/seams\/tools$/,
  /^@\/lib\/seams\/dynamic$/,
  /^node:/,
];

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

/** 收集一个文件里所有**值导入**的模块名（跳过 `import type ...`） */
function valueImports(source: string): string[] {
  const out: string[] = [];
  for (const m of source.matchAll(/import\s+(?!type\s)([\s\S]*?)\s+from\s+["']([^"']+)["']/g)) {
    out.push(m[2]);
  }
  // 副作用导入 import "x"
  for (const m of source.matchAll(/import\s+["']([^"']+)["']/g)) out.push(m[1]);
  return out;
}

describe("客户端 / 服务端边界", () => {
  it("检测器自身有效：能识别值导入、忽略 type 导入", () => {
    expect(valueImports('import { getDb } from "@/lib/local/sqlite";')).toContain(
      "@/lib/local/sqlite",
    );
    expect(valueImports('import "better-sqlite3";')).toContain("better-sqlite3");
    expect(valueImports('import type { LocalUser } from "@/lib/local/auth";')).toEqual([]);
  });

  it("客户端目录不得值导入服务端专用模块（替代 server-only 打包守卫）", () => {
    const offenders: string[] = [];
    for (const dir of CLIENT_DIRS) {
      for (const file of walk(path.join(ROOT, dir))) {
        const source = fs.readFileSync(file, "utf8");
        for (const spec of valueImports(source)) {
          if (FORBIDDEN.some((re) => re.test(spec))) {
            offenders.push(`${path.relative(ROOT, file)} → ${spec}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("服务端目录不得引用 React 组件（方向反了同样是架构错误）", () => {
    const offenders: string[] = [];
    for (const file of walk(path.join(ROOT, "server"))) {
      const source = fs.readFileSync(file, "utf8");
      for (const spec of valueImports(source)) {
        if (/^@\/components\//.test(spec) || /^@\/src\//.test(spec)) {
          offenders.push(`${path.relative(ROOT, file)} → ${spec}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  // UI 层不得直接导入数据模块：一律经内核的 docStore 接缝（可换实现、可 mock、可审计）。
  // 例外：lib/client/* 是 REST 提供方本体（它就是 @/lib/db 的适配器）。
  it("UI 层不得直接导入 @/lib/db（必须走内核 docStore 接缝）", () => {
    const UI_DIRS = ["src", "components", "hooks"];
    const offenders: string[] = [];
    for (const dir of UI_DIRS) {
      for (const file of walk(path.join(ROOT, dir))) {
        const source = fs.readFileSync(file, "utf8");
        if (valueImports(source).includes("@/lib/db")) {
          offenders.push(path.relative(ROOT, file));
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  // 内核（lib/kernel）浏览器与服务端共用同一份：必须环境无关，
  // 否则客户端打包会把 better-sqlite3 / node:vm 之类带进浏览器 bundle。
  it("内核必须是环境无关的纯 TS（不得引用 node:/服务端专用模块/React）", () => {
    const offenders: string[] = [];
    for (const file of walk(path.join(ROOT, "lib/kernel"))) {
      const source = fs.readFileSync(file, "utf8");
      for (const spec of valueImports(source)) {
        if (
          FORBIDDEN.some((re) => re.test(spec)) ||
          /^react/.test(spec) ||
          /^@\/lib\/local\//.test(spec)
        ) {
          offenders.push(`${path.relative(ROOT, file)} → ${spec}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
