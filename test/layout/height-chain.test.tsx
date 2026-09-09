// @vitest-environment jsdom
// 布局高度链防复发测试。
//
// 背景（真实事故）：迁移到 Vite SPA 后，React 树挂在 <div id="root"> 下（Next.js 时代直接挂
// <body>），而 globals.css 的高度规则只写了 html/body——#root 没有高度，于是所有 h-full
// 退化成"内容高度"：三栏 shell 变成左右栏跟着文档高度走、三列都无法独立滚动（整页滚动）。
//
// jsdom 没有布局引擎，无法测量真实高度，故这里守的是**结构不变量**：
//   1. CSS 高度链必须包含 #root；
//   2. 外壳必须用视口单位高度（h-dvh），不依赖祖先高度链；
//   3. 三列各自是可滚动区域（overflow-y-auto 且带 min-h-0，否则 flex 子项不会收缩）。
// 真实浏览器下的高度/滚动验证见提交记录（Chrome CDP 实测）。
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { UserProvider } from "@/hooks/use-user";
import { routes } from "@/src/router";

const ROOT = path.resolve(import.meta.dirname, "../..");

describe("CSS 高度链", () => {
  it("globals.css 为 html / body / #root 都声明了高度", () => {
    const css = fs.readFileSync(path.join(ROOT, "src/styles/globals.css"), "utf8");
    // 取第一条同时列出多个选择器的高度声明块
    const block = css.match(/html,\s*body,\s*#root,\s*:root\s*\{\s*height:\s*100%\s*\}/);
    expect(block, "globals.css 缺少 html/body/#root 高度链（#root 缺失会让 h-full 全部退化）")
      .not.toBeNull();
  });
});

describe("三栏外壳的滚动结构", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    // 按路径分派 mock：/api/me 返回已登录用户，其余端点返回合法空数据
    // （AI 面板/侧边栏会消费列表，返回非数组会直接抛错并触发错误边界）
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
              title: "布局测试",
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

  /** 挂载 /documents/d1，等三栏与懒加载的 AI 面板就绪后返回外壳元素 */
  async function mountShell(): Promise<HTMLDivElement> {
    const router = createMemoryRouter(routes, { initialEntries: ["/documents/d1"] });
    await act(async () => {
      root.render(
        <UserProvider initialUser={null}>
          <RouterProvider router={router} />
        </UserProvider>,
      );
    });

    // 会话解析 + AI 面板是 lazy chunk，就绪时间不稳定：轮询而非固定等待
    const deadline = Date.now() + 3000;
    let shell: HTMLDivElement | null = null;
    while (Date.now() < deadline) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 25));
      });
      const candidate = container.querySelector<HTMLDivElement>("div.grid");
      const detailsReady = candidate?.children[2]?.querySelector(".overflow-y-auto");
      if (candidate && detailsReady) {
        shell = candidate;
        break;
      }
    }

    expect(shell, "未渲染出三栏 shell（含 AI 面板滚动区）").not.toBeNull();
    return shell!;
  }

  it("外壳用视口高度（h-dvh）+ overflow-hidden，不依赖祖先高度链", async () => {
    const shell = await mountShell();
    expect(shell.className).toContain("h-dvh");
    expect(shell.className).toContain("overflow-hidden");
  });

  it("左（侧边栏）中（正文）右（AI 面板）各有一个可滚动区域", async () => {
    const shell = await mountShell();
    const [sidebarSlot, centerSlot, detailsSlot] = [...shell.children] as HTMLElement[];

    const regions = [
      { name: "sidebar", el: sidebarSlot.querySelector<HTMLElement>(".overflow-y-auto") },
      { name: "center", el: centerSlot.querySelector<HTMLElement>("main.overflow-y-auto") },
      { name: "details", el: detailsSlot.querySelector<HTMLElement>(".overflow-y-auto") },
    ];

    for (const { name, el } of regions) {
      expect(el, `${name} 列缺少滚动区域`).not.toBeNull();
      // min-h-0 是 flex 子项能真正收缩（进而出现滚动条）的前提
      expect(el!.className, `${name} 列滚动容器缺少 min-h-0`).toContain("min-h-0");
    }
  });

  it("中心列是 flex 容器，正文区能吸收剩余高度", async () => {
    const shell = await mountShell();
    const [, centerSlot] = [...shell.children] as HTMLElement[];
    expect(centerSlot.className).toContain("flex-col");
    expect(centerSlot.className).toContain("min-h-0");
    expect(centerSlot.querySelector("main")?.className).toContain("flex-1");
  });
});

describe("浮层高度上限", () => {
  it("回收站浮层有 max-h 且列表区可滚动（长列表不会撑出视口）", () => {
    const footer = fs.readFileSync(
      path.join(ROOT, "src/shell/sidebar/sidebar-footer.tsx"),
      "utf8",
    );
    expect(footer, "回收站 PopoverContent 缺少 max-h 限制").toMatch(
      /PopoverContent[\s\S]{0,200}max-h-\[60vh\]/,
    );

    const trash = fs.readFileSync(path.join(ROOT, "src/shell/trash-box.tsx"), "utf8");
    expect(trash, "TrashBox 列表区缺少滚动").toMatch(/min-h-0 flex-1 overflow-y-auto/);
  });
});
