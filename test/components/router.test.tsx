// @vitest-environment jsdom
// 路由集成测试：真实挂载 router（含 Provider、守卫、懒加载），验证迁移后
// 的 SPA 路由表与 Next.js App Router 语义一致。
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { UserProvider } from "@/hooks/use-user";
import { routes } from "@/src/router";

let container: HTMLDivElement;
let root: Root;

/** 让 /api/me 返回未登录（守卫应把 /documents 重定向到 /login） */
function mockAnonymous() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ user: null }), { status: 401 })),
  );
}

/** 让 /api/me 返回已登录用户；其余端点返回空列表（按路径分派，避免串数据） */
function mockLoggedIn(email = "u@x.com") {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/me")) {
        return new Response(JSON.stringify({ user: { id: "u1", email, name: null } }), {
          status: 200,
        });
      }
      if (url.includes("/api/documents")) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    }),
  );
}

async function mountAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  await act(async () => {
    root.render(
      <ThemeProvider attribute="class" defaultTheme="light" storageKey="t">
        <UserProvider initialUser={null}>
          <RouterProvider router={router} />
        </UserProvider>
      </ThemeProvider>,
    );
  });
  // 等待 /api/me 与懒加载 chunk 落地
  await act(async () => {
    await new Promise((r) => setTimeout(r, 50));
  });
  return router;
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("路由表", () => {
  it("/login 渲染登录页", async () => {
    mockAnonymous();
    await mountAt("/login");
    expect(container.textContent).toContain("登录 Lotion");
    expect(container.textContent).toContain("注册");
  });

  it("/register 渲染注册页", async () => {
    mockAnonymous();
    await mountAt("/register");
    expect(container.textContent).toContain("注册 Lotion");
  });

  it("/ 渲染着陆页（公开，无需会话）", async () => {
    mockAnonymous();
    await mountAt("/");
    expect(container.textContent).toContain("Lotion");
    // 着陆页有登录/注册入口（文案为英文）
    expect(container.textContent).toMatch(/Login|Sign up/);
  });

  it("未登录访问 /documents 被守卫重定向到 /login", async () => {
    mockAnonymous();
    const router = await mountAt("/documents");
    expect(router.state.location.pathname).toBe("/login");
    expect(container.textContent).toContain("登录 Lotion");
  });

  it("已登录访问 /documents 进入主界面（不重定向）", async () => {
    mockLoggedIn();
    const router = await mountAt("/documents");
    expect(router.state.location.pathname).toBe("/documents");
  });

  it("未知路径落到 404 页", async () => {
    mockAnonymous();
    await mountAt("/no-such-page");
    expect(container.textContent).toContain("页面不存在");
  });
});
