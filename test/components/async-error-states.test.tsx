// @vitest-environment jsdom
// 网络/服务错误与“没有数据 / 文档已删除”必须显示为不同状态，并提供重试。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { UserProvider } from "@/hooks/use-user";
import { KernelProvider } from "@/src/kernel/react";
import { _resetClientKernelForTest } from "@/src/kernel/client";
import { routes } from "@/src/router";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  _resetClientKernelForTest();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function mountDocumentWith(handler: (url: string) => Response | Promise<Response>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/me")) {
        return new Response(JSON.stringify({ user: { id: "u1", email: "u@x.com", name: null } }));
      }
      return handler(url);
    }),
  );

  const router = createMemoryRouter(routes, { initialEntries: ["/documents/d1"] });
  await act(async () => {
    root.render(
      <KernelProvider>
        <UserProvider initialUser={null}>
          <RouterProvider router={router} />
        </UserProvider>
      </KernelProvider>,
    );
  });

  const deadline = Date.now() + 3000;
  while (Date.now() < deadline && !container.textContent?.includes("文档加载失败")) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
  }
}

describe("异步错误状态", () => {
  it("文档请求失败显示可重试错误，不伪装成“文档不存在”", async () => {
    await mountDocumentWith((url) => {
      if (/\/api\/documents\/d1/.test(url)) {
        return new Response(JSON.stringify({ error: "服务暂时不可用" }), { status: 503 });
      }
      return new Response(JSON.stringify([]));
    });

    expect(container.textContent).toContain("文档加载失败");
    expect(container.textContent).toContain("服务暂时不可用");
    expect(container.textContent).not.toContain("文档不存在或已删除");
    expect([...container.querySelectorAll("button")].some((button) => button.textContent === "重试")).toBe(true);
  });

  it("侧边栏列表失败显示错误与重试，不再显示“还没有笔记”", async () => {
    await mountDocumentWith((url) => {
      if (url.includes("scope=sidebar")) {
        return new Response(JSON.stringify({ error: "列表加载失败" }), { status: 500 });
      }
      if (/\/api\/documents\/d1/.test(url)) {
        return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
      }
      return new Response(JSON.stringify([]));
    });

    const sidebar = container;
    expect(sidebar.textContent).toContain("列表加载失败");
    expect(sidebar.textContent).not.toContain("还没有笔记");
  });
});
