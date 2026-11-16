import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), "utf8");

describe("侧边栏持久实例与动效", () => {
  it("wide / rail / 抽屉共用同一个 Sidebar，不再用 early return 切换 DOM", () => {
    const sidebar = read("src/shell/sidebar/sidebar.tsx");
    expect(sidebar).toContain('data-sidebar-shell')
    expect(sidebar).toContain('data-sidebar-wide={wide || undefined}')
    expect(sidebar).not.toContain("if (!wide)");
    expect(sidebar).toContain("absolute inset-0 flex min-h-0 flex-col");
    expect(sidebar).toContain("absolute inset-0 flex flex-col items-center");
  });

  it("窄屏抽屉原地滑入滑出，关闭动效结束后才回落 rail", () => {
    const shell = read("src/shell/app-shell.tsx");
    expect(shell).not.toContain("function SidebarDrawer");
    expect(shell).toContain("sidebarDrawerVisible");
    expect(shell).toContain("drawerRenderedOpen");
    expect(shell).toContain("transition-transform duration-200");
    expect(shell).toContain("window.setTimeout(() => setSidebarClosing(false), 220)");
    expect(shell).toContain("data-sidebar-drawer-open");
  });

  it("侧栏拖拽期间手柄取消 left 过渡，并给键盘/悬停显示抓手", () => {
    const shell = read("src/shell/app-shell.tsx");
    expect(shell).toContain('dragging ? "transition-none "');
    expect(shell).toContain("hover:after:opacity-100");
    expect(shell).toContain("focus-visible:after:opacity-100");
  });
});
