// @vitest-environment jsdom
// 登录/注册的网络异常必须结束 loading，并向用户显示可感知的错误。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { UserProvider } from "@/hooks/use-user";
import LoginPage from "@/src/pages/login";
import RegisterPage from "@/src/pages/register";

let container: HTMLDivElement;
let root: Root;

function setInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

async function mount(page: "login" | "register") {
  const router = createMemoryRouter(
    [
      { path: "/login", element: <LoginPage /> },
      { path: "/register", element: <RegisterPage /> },
      { path: "/documents", element: <div>documents page</div> },
    ],
    { initialEntries: [`/${page}`] },
  );
  await act(async () => {
    root.render(
      <UserProvider initialUser={null}>
        <RouterProvider router={router} />
      </UserProvider>,
    );
  });
  return router;
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/me")) {
        throw new Error("offline");
      }
      throw new TypeError("Failed to fetch");
    }),
  );
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe.each(["login", "register"] as const)("%s 网络异常", (page) => {
  it("恢复按钮并显示网络错误", async () => {
    await mount(page);
    const inputs = [...container.querySelectorAll("input")];
    await act(async () => {
      setInput(inputs[0], "user@example.com");
      setInput(inputs[1], "password123");
    });
    await act(async () => {
      container.querySelector("form")!.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(container.textContent).toContain("无法连接服务器");
    const submit = container.querySelector<HTMLButtonElement>('button[type="submit"]');
    expect(submit?.disabled).toBe(false);
  });
});

it("注册成功后等待强制刷新用户，再进入主界面，不被旧的匿名请求重定向", async () => {
  let meCalls = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/me")) {
        meCalls++;
        await new Promise((resolve) => setTimeout(resolve, meCalls === 1 ? 60 : 5));
        return new Response(
          JSON.stringify({
            user:
              meCalls === 1
                ? null
                : { id: "u1", email: "user@example.com", name: null },
          }),
        );
      }
      if (url.includes("/api/auth/register")) {
        return new Response(JSON.stringify({ ok: true }));
      }
      return new Response(JSON.stringify([]));
    }),
  );

  const router = await mount("register");
  const inputs = [...container.querySelectorAll("input")];
  await act(async () => {
    setInput(inputs[0], "user@example.com");
    setInput(inputs[1], "password123");
  });
  await act(async () => {
    container.querySelector("form")!.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  expect(router.state.location.pathname).toBe("/documents");
  expect(container.textContent).toContain("documents page");
});
