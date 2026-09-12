// server/load-env.ts 单测 —— env 文件加载 + 入口加载顺序守卫。
// 背景：迁移 Next.js → Hono 后，tsx/node 不再自动读 .env，DEEPSEEK_API_KEY 丢失
// 导致 AI 助手报「API key is missing」。这里覆盖加载语义，并静态守卫入口顺序（防回归）。
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ENV_FILES, loadEnvFiles } from "@/server/load-env";

const ROOT = path.resolve(import.meta.dirname, "../..");
/** 测试期间被写入 process.env 的键，逐条还原（避免污染同进程内的其他测试） */
const TOUCHED = ["LOTION_ENV_TEST_A", "LOTION_ENV_TEST_B", "LOTION_ENV_TEST_C"];
let saved: Record<string, string | undefined> = {};

let dir = "";
const write = (name: string, content: string) => {
  const file = path.join(dir, name);
  fs.writeFileSync(file, content);
  return file;
};

beforeEach(() => {
  saved = {};
  for (const key of TOUCHED) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "lotion-env-"));
});

afterEach(() => {
  for (const key of TOUCHED) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("server/load-env ENV_FILES", () => {
  it("默认锚定仓库根目录，且 .env.local 优先于 .env", () => {
    expect(ENV_FILES).toEqual([
      path.join(ROOT, ".env.local"),
      path.join(ROOT, ".env"),
    ]);
  });
});

describe("server/load-env loadEnvFiles", () => {
  it("把存在的 env 文件注入 process.env，并返回已加载文件列表", () => {
    const file = write(".env.local", "LOTION_ENV_TEST_A=from-file\n");
    const loaded = loadEnvFiles([file]);

    expect(loaded).toEqual([file]);
    expect(process.env.LOTION_ENV_TEST_A).toBe("from-file");
  });

  it("已存在的环境变量优先，文件不覆盖（与 node --env-file 语义一致）", () => {
    process.env.LOTION_ENV_TEST_A = "from-real-env";
    const file = write(".env", "LOTION_ENV_TEST_A=from-file\n");

    loadEnvFiles([file]);

    expect(process.env.LOTION_ENV_TEST_A).toBe("from-real-env");
  });

  it("缺失文件静默跳过，不抛错也不计入返回值", () => {
    const missing = path.join(dir, ".env.nope");
    const present = write(".env", "LOTION_ENV_TEST_B=ok\n");

    expect(() => loadEnvFiles([missing])).not.toThrow();
    expect(loadEnvFiles([missing, present])).toEqual([present]);
    expect(process.env.LOTION_ENV_TEST_B).toBe("ok");
  });

  it("先加载的文件优先：.env.local 的值不被后面的 .env 覆盖", () => {
    const local = write(".env.local", "LOTION_ENV_TEST_C=local\n");
    const plain = write(".env", "LOTION_ENV_TEST_C=plain\n");

    expect(loadEnvFiles([local, plain])).toEqual([local, plain]);
    expect(process.env.LOTION_ENV_TEST_C).toBe("local");
  });

  it("清掉引号与注释，值可用（真实 .env.local 的写法）", () => {
    const file = write(".env.local", '# 注释\nLOTION_ENV_TEST_A="sk-quoted"\nLOTION_ENV_TEST_B=\n');

    loadEnvFiles([file]);

    expect(process.env.LOTION_ENV_TEST_A).toBe("sk-quoted");
    expect(process.env.LOTION_ENV_TEST_B).toBe("");
  });

  it("空文件列表是安全的空操作", () => {
    expect(loadEnvFiles([])).toEqual([]);
  });
});

// 入口顺序守卫：本次 bug 的成因正是「入口没有加载 .env」。
// server/index.ts 必须先调 loadEnvFiles() 再（动态）导入 ./app —— app 及其路由
// 会连带在**模块顶层**读 process.env（lib/agent.ts 的 AI_MODEL）。
describe("server/index.ts 入口顺序", () => {
  const source = fs.readFileSync(path.join(ROOT, "server/index.ts"), "utf8");

  it("调用 loadEnvFiles()", () => {
    expect(source).toMatch(/loadEnvFiles\(/);
  });

  it("先加载 env，再导入 ./app（静态 import 会被提升，故必须是动态 import）", () => {
    const loadAt = source.indexOf("loadEnvFiles(");
    const appImportAt = source.indexOf('import("./app")');
    expect(appImportAt).toBeGreaterThan(-1);
    expect(loadAt).toBeGreaterThan(-1);
    expect(loadAt).toBeLessThan(appImportAt);
    // 不允许出现静态 `from "./app"`（会先于 loadEnvFiles 执行）
    expect(source).not.toMatch(/from\s+["']\.\/app["']/);
  });
});
