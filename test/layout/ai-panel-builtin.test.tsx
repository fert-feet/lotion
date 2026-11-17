// @vitest-environment jsdom
// AI 面板是 shell 内建能力：即使没有任何 UI 插件，入口、详情列与 ⌘J 也必须成立。
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { UserProvider } from "@/hooks/use-user";
import { useLayout } from "@/hooks/use-layout";
import { KernelProvider } from "@/src/kernel/react";
import { _resetClientKernelForTest } from "@/src/kernel/client";
import { routes } from "@/src/router";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  _resetClientKernelForTest();
  useLayout.setState({
    sidebar: 264,
    details: 0,
    narrow: false,
    narrowExpanded: false,
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/me")) {
        return new Response(JSON.stringify({ user: { id: "u1", email: "u@x.com", name: null } }));
      }
      return new Response(JSON.stringify([]));
    }),
  );
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  _resetClientKernelForTest();
});

async function mountShell(): Promise<HTMLDivElement> {
  const router = createMemoryRouter(routes, { initialEntries: ["/documents/d1"] });
  await act(async () => {
    root.render(
      // 关键：不注入任何 UI 插件，验证 AI 面板不依赖 uiSlots 贡献者。
      <KernelProvider>
        <UserProvider initialUser={null}>
          <RouterProvider router={router} />
        </UserProvider>
      </KernelProvider>,
    );
  });

  const deadline = Date.now() + 3000;
  let shell: HTMLDivElement | null = null;
  while (Date.now() < deadline) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
    const candidate = container.querySelector<HTMLDivElement>("div.grid");
    if (candidate?.querySelector("[data-details-column]")) {
      shell = candidate;
      break;
    }
  }
  expect(shell, "未渲染出内建 AI 详情列").not.toBeNull();
  return shell!;
}

describe("内建 AI 面板", () => {
  it("没有任何 UI 插件时，AI 入口与详情列仍存在", async () => {
    const shell = await mountShell();
    expect(shell.querySelector('button[aria-label="AI 助手"]')).not.toBeNull();
    expect(shell.querySelector("[data-details-column]")).not.toBeNull();
  });

  it("⌘J 始终由 shell 接管并开合 AI 面板", async () => {
    const shell = await mountShell();
    const before = useLayout.getState().details;

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "j", metaKey: true }));
    });

    expect(useLayout.getState().details).not.toBe(before);
    expect(shell.querySelector("[data-details-column]")).not.toBeNull();
  });
});
