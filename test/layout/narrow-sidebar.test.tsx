// @vitest-environment jsdom
// 窄屏侧边栏必须是覆盖式抽屉：展开时不能挤压正文，导航、Esc 与遮罩都能收起。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { UserProvider } from "@/hooks/use-user";
import { useLayout } from "@/hooks/use-layout";
import { KernelProvider } from "@/src/kernel/react";
import { _resetClientKernelForTest } from "@/src/kernel/client";
import { shellUiPlugins } from "@/src/shell/ui-plugins";
import { routes } from "@/src/router";

let container: HTMLDivElement;
let root: Root;

function stubViewport(width: number) {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    width,
    height: 812,
    top: 0,
    left: 0,
    right: width,
    bottom: 812,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private cb: ResizeObserverCallback) {}
      observe() {
        this.cb([], this as unknown as ResizeObserver);
      }
      unobserve() {}
      disconnect() {}
    },
  );
}

async function mountShell() {
  const router = createMemoryRouter(routes, { initialEntries: ["/documents"] });
  await act(async () => {
    root.render(
      <KernelProvider options={{ extraPlugins: shellUiPlugins() }}>
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
    if (candidate?.dataset.sidebarCollapsed === "true") {
      shell = candidate;
      break;
    }
  }
  expect(shell, "窄屏外壳未完成自动折叠").not.toBeNull();
  return { shell: shell!, router };
}

function splitTracks(value: string): string[] {
  return value.match(/(?:minmax\([^)]*\)|[^\s]+)/g) ?? [];
}

beforeEach(() => {
  _resetClientKernelForTest();
  useLayout.setState({ sidebar: 280, details: 0, narrow: false, narrowExpanded: false });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  stubViewport(375);
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
  vi.restoreAllMocks();
});

describe("窄屏侧边栏抽屉", () => {
  it("展开后覆盖正文、不占用网格列", async () => {
    const { shell } = await mountShell();
    const opener = shell.querySelector<HTMLButtonElement>('button[aria-label="展开侧边栏"]');
    expect(opener).not.toBeNull();

    await act(async () => {
      opener!.click();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(shell.dataset.sidebarOverlay).toBe("true");
    expect(splitTracks(shell.style.gridTemplateColumns)[0]).toBe("0px");
    expect(shell.querySelector('[role="dialog"][aria-label="笔记导航"]')).not.toBeNull();
  });

  it("路由变化后自动收起抽屉", async () => {
    const { shell, router } = await mountShell();
    await act(async () => {
      shell.querySelector<HTMLButtonElement>('button[aria-label="展开侧边栏"]')!.click();
    });

    await act(async () => {
      await router.navigate("/market");
    });

    expect(useLayout.getState().narrowExpanded).toBe(false);
    expect(shell.dataset.sidebarOverlay).toBeUndefined();
  });

  it("Esc 与遮罩都能关闭抽屉", async () => {
    const { shell } = await mountShell();
    await act(async () => {
      shell.querySelector<HTMLButtonElement>('button[aria-label="展开侧边栏"]')!.click();
    });

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(useLayout.getState().narrowExpanded).toBe(false);

    await act(async () => {
      shell.querySelector<HTMLButtonElement>('button[aria-label="展开侧边栏"]')!.click();
    });
    const scrim = shell.querySelector<HTMLElement>("[data-sidebar-scrim]");
    expect(scrim).not.toBeNull();
    await act(async () => {
      scrim!.click();
    });
    expect(useLayout.getState().narrowExpanded).toBe(false);
  });
});
