import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

// ---- mocks ----

const { getUserMock, createServerClientMock } = vi.hoisted(() => {
  const getUserMock = vi.fn();
  return {
    getUserMock,
    createServerClientMock: vi.fn((..._args: unknown[]) => ({
      auth: { getUser: getUserMock },
    })),
  };
});

vi.mock("@supabase/ssr", () => ({
  createServerClient: (...args: unknown[]) => createServerClientMock(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
});

function makeRequest(path: string) {
  return new NextRequest(`http://localhost${path}`);
}

// ---- tests ----

describe("updateSession 路由守卫", () => {
  it("未登录访问受保护页面重定向到 /login", async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: null });
    const res = await updateSession(makeRequest("/documents"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost/login");
  });

  it("未登录访问 /login 放行", async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: null });
    const res = await updateSession(makeRequest("/login"));
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it("未登录访问 /register 放行", async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: null });
    const res = await updateSession(makeRequest("/register"));
    expect(res.status).toBe(200);
  });

  it("未登录访问公开预览页放行", async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: null });
    const res = await updateSession(makeRequest("/preview/doc-1"));
    expect(res.status).toBe(200);
  });

  it("未登录访问 /preview（列表路径）放行", async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: null });
    const res = await updateSession(makeRequest("/preview"));
    expect(res.status).toBe(200);
  });

  it("已登录访问受保护页面放行", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
    const res = await updateSession(makeRequest("/documents/doc-1"));
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });
});
