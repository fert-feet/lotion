// 图片上传/读取/删除 API 单测：UPLOAD_DIR 指向临时目录，真实读写文件
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import { SESSION_COOKIE } from "@/lib/local/auth";
import { POST as upload } from "@/app/api/upload/route";
import { GET as getFile, DELETE as deleteFile } from "@/app/api/uploads/[filename]/route";

const state = vi.hoisted(() => ({ db: null as Database.Database | null }));

vi.mock("@/lib/local/sqlite", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/local/sqlite")>();
  return { ...actual, getDb: () => state.db! };
});

let uploadDir: string;

async function authCookie(): Promise<string> {
  const { createUser, createSession } = await import("@/lib/local/auth");
  const user = createUser(state.db!, "u@x.com", "password123");
  const token = createSession(state.db!, user.id);
  return `${SESSION_COOKIE}=${token}`;
}

function multipartRequest(cookie: string, file: Blob, name = "test.png", type = "image/png"): Request {
  const form = new FormData();
  form.append("file", new File([file], name, { type }));
  const headers = new Headers();
  if (cookie) headers.set("cookie", cookie);
  return new Request("http://x/api/upload", { method: "POST", headers, body: form });
}

function ctx(filename: string): { params: Promise<{ filename: string }> } {
  return { params: Promise.resolve({ filename }) };
}

beforeEach(async () => {
  const { initDatabase } = await import("@/lib/local/sqlite");
  const { default: Database } = await import("better-sqlite3");
  const db = new Database(":memory:");
  initDatabase(db);
  state.db = db;

  uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), "lotion-upload-"));
  process.env.UPLOAD_DIR = uploadDir;
});

afterEach(() => {
  delete process.env.UPLOAD_DIR;
  fs.rmSync(uploadDir, { recursive: true, force: true });
});

describe("upload API", () => {
  it("未登录上传返回 401", async () => {
    const res = await upload(multipartRequest("", new Blob(["x"])));
    expect(res.status).toBe(401);
  });

  it("上传 PNG 落盘并返回 /api/uploads URL，随后可读取", async () => {
    const cookie = await authCookie();
    const res = await upload(multipartRequest(cookie, new Blob([new Uint8Array([1, 2, 3])])));
    expect(res.status).toBe(200);
    const { url } = await res.json();
    expect(url).toMatch(/^\/api\/uploads\/[0-9a-f-]{36}\.png$/);

    const filename = url.split("/").pop()!;
    const files = fs.readdirSync(uploadDir);
    expect(files).toEqual([filename]);

    const get = await getFile(new Request("http://x"), ctx(filename));
    expect(get.status).toBe(200);
    expect(get.headers.get("Content-Type")).toBe("image/png");
    expect(new Uint8Array(await get.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("非法 MIME / 非 file 字段 / 空表单返回 400", async () => {
    const cookie = await authCookie();
    expect((await upload(multipartRequest(cookie, new Blob(["x"]), "a.txt", "text/plain"))).status).toBe(400);

    const form = new FormData();
    form.append("foo", "bar");
    const res = await upload(
      new Request("http://x/api/upload", { method: "POST", headers: { cookie }, body: form }),
    );
    expect(res.status).toBe(400);
  });

  it("路径穿越与未知文件名读取返回 404", async () => {
    expect((await getFile(new Request("http://x"), ctx("..%2F..%2Fetc%2Fpasswd"))).status).toBe(404);
    expect((await getFile(new Request("http://x"), ctx("no-such.png"))).status).toBe(404);
    expect((await getFile(new Request("http://x"), ctx("evil-name.txt"))).status).toBe(404);
  });

  it("DELETE 删除文件并幂等", async () => {
    const cookie = await authCookie();
    const { url } = await (await upload(multipartRequest(cookie, new Blob(["x"])))).json();
    const filename = url.split("/").pop()!;

    const del = await deleteFile(new Request("http://x", { method: "DELETE" }), ctx(filename));
    expect(del.status).toBe(200);
    expect(fs.readdirSync(uploadDir)).toHaveLength(0);

    // 再删一次仍成功（文件不存在视为幂等成功）
    expect((await deleteFile(new Request("http://x", { method: "DELETE" }), ctx(filename))).status).toBe(200);
  });
});
