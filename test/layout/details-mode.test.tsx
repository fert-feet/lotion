// @vitest-environment jsdom
// AI 面板（details 列）的三种呈现模式：停靠 / 浮层 / 全屏。
//
// 背景：此前只有"列宽"一个维度——宽屏常驻挤压正文，窄屏由让步链把列压成 0 再隐式
// 改浮层。同一功能三套行为，用户无法预期。现在宽度只是 docked 模式下的偏好，
// 呈现模式由用户显式选择（列头切换器 / ⌘⇧J 循环）。
//
// jsdom 无布局引擎，故这里守**结构不变量**：网格轨道、浮层遮罩、以及"全屏时正文
// 不卸载（压成 0 宽）"。
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { UserProvider } from "@/hooks/use-user";
import { useLayout } from "@/hooks/use-layout";
import { KernelProvider } from "@/src/kernel/react";
import { shellUiPlugins } from "@/src/shell/ui-plugins";
import { routes } from "@/src/router";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  useLayout.setState({
    sidebar: 280,
    details: 360,
    detailsMode: "docked",
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
      if (/\/api\/documents\/[^/?]+$/.test(url)) {
        return new Response(
          JSON.stringify({
            id: "d1",
            title: "模式测试",
            userId: "u1",
            isArchived: false,
            isDraft: false,
            parentDocument: null,
            content: null,
            coverImage: null,
            icon: null,
            isPublished: false,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          }),
        );
      }
      return new Response(JSON.stringify([]));
    }),
  );
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function mountShell(): Promise<HTMLDivElement> {
  const router = createMemoryRouter(routes, { initialEntries: ["/documents/d1"] });
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
      await new Promise((r) => setTimeout(r, 25));
    });
    const candidate = container.querySelector<HTMLDivElement>("div.grid");
    if (candidate && candidate.querySelector("[data-details-column]")) {
      shell = candidate;
      break;
    }
  }
  expect(shell, "未渲染出三栏 shell").not.toBeNull();
  return shell!;
}

/** 拆网格轨道：`minmax(0, 1fr)` 内部有空格，不能直接 split(" ") */
function tracks(shell: HTMLDivElement): string[] {
  const raw = shell.style.gridTemplateColumns;
  const out: string[] = [];
  let depth = 0;
  let buf = "";
  for (const ch of raw) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (/\s/.test(ch) && depth === 0) {
      if (buf) out.push(buf);
      buf = "";
      continue;
    }
    buf += ch;
  }
  if (buf) out.push(buf);
  return out;
}

/** 切换模式并等待一次提交 */
async function setMode(mode: "docked" | "overlay" | "fullscreen") {
  await act(async () => {
    useLayout.getState().setDetailsMode(mode);
  });
}

describe("AI 面板呈现模式", () => {
  it("默认停靠：details 是真实网格列（px 轨道），无遮罩", async () => {
    const shell = await mountShell();
    expect(shell.dataset.detailsMode).toBe("docked");
    expect(shell.dataset.detailsFullscreen).toBeUndefined();
    expect(shell.dataset.detailsOverlay).toBeUndefined();

    const cols = tracks(shell);
    expect(cols).toHaveLength(3);
    expect(cols[2]).toBe("360px");
    expect(shell.querySelector("[data-details-column]")?.getAttribute("data-details-overlay")).toBeNull();
  });

  it("浮层：details 不再占轨道（0px）+ 渲染遮罩，点击遮罩关闭", async () => {
    const shell = await mountShell();
    await setMode("overlay");

    expect(shell.dataset.detailsOverlay).toBe("true");
    expect(tracks(shell)[2]).toBe("0px");
    // 面板转为 fixed 浮层
    expect(shell.querySelector("[data-details-column]")?.className).toContain("fixed");

    const scrim = container.querySelector<HTMLDivElement>('div[aria-hidden="true"].fixed.inset-0');
    expect(scrim, "浮层模式缺少点击关闭的遮罩").not.toBeNull();
    await act(async () => {
      scrim!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(useLayout.getState().details, "点遮罩应当关闭面板").toBe(0);
  });

  it("全屏：正文轨道压成 0（不卸载），details 铺满剩余宽度", async () => {
    const shell = await mountShell();
    const centerBefore = shell.children[1];
    await setMode("fullscreen");

    expect(shell.dataset.detailsFullscreen).toBe("true");
    const cols = tracks(shell);
    expect(cols[1], "正文轨道应为 0px").toBe("0px");
    expect(cols[2].replace(/\s+/g, ""), "details 应铺满剩余宽度").toBe("minmax(0,1fr)");
    // 正文列仍是同一个 DOM 节点：全屏是"压成 0 宽"，不是路由跳转或卸载
    expect(shell.children[1]).toBe(centerBefore);
    expect(shell.children[1]?.querySelector("main")).not.toBeNull();
    // 全屏时不渲染 details 拖拽手柄（宽度铺满，无可拖语义）
    expect(shell.dataset.detailsMode).toBe("fullscreen");
  });

  it("列头切换器：三个模式按钮，当前模式 aria-pressed=true", async () => {
    await mountShell();
    // 停靠模式下就已存在（否则用户只能用快捷键离开停靠）
    expect(
      container.querySelector('[role="group"][aria-label="AI 面板呈现模式"]'),
      "停靠模式缺少切换器",
    ).not.toBeNull();
    await setMode("fullscreen");

    const group = container.querySelector<HTMLDivElement>('[role="group"][aria-label="AI 面板呈现模式"]');
    expect(group, "缺少呈现模式切换器（只放在全屏里会让「如何回去」变成隐藏知识）").not.toBeNull();
    const buttons = [...group!.querySelectorAll("button")];
    expect(buttons.map((b) => b.textContent)).toEqual(["停靠", "浮层", "全屏"]);
    expect(buttons.filter((b) => b.getAttribute("aria-pressed") === "true")).toHaveLength(1);
    expect(buttons[2]!.getAttribute("aria-pressed")).toBe("true");

    // 点「浮层」真的切换
    await act(async () => {
      buttons[1]!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(useLayout.getState().detailsMode).toBe("overlay");
  });

  it("⌘⇧J 循环模式，⌘J 仍然只开合（不改模式）", async () => {
    await mountShell();
    const key = async (init: KeyboardEventInit) => {
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "j", bubbles: true, ...init }));
      });
    };

    await key({ metaKey: true, shiftKey: true });
    expect(useLayout.getState().detailsMode).toBe("overlay");
    await key({ metaKey: true, shiftKey: true });
    expect(useLayout.getState().detailsMode).toBe("fullscreen");

    // ⌘J 只开合：从全屏关闭，再按一次回到全屏（模式保持）
    await key({ metaKey: true });
    expect(useLayout.getState().details).toBe(0);
    await key({ metaKey: true });
    expect(useLayout.getState().details).toBeGreaterThan(0);
    expect(useLayout.getState().detailsMode).toBe("fullscreen");
  });
});
