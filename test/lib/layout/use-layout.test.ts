// 布局 store 单测（hooks/use-layout.ts）：宽度偏好语义与 DSH stores.ts 对齐
import { describe, it, expect, beforeEach } from "vitest";
import { useLayout } from "@/hooks/use-layout";
import { DETAILS_DEFAULT, SIDEBAR_DEFAULT } from "@/lib/layout/columns";

// 每个用例前重置 store 到初始状态
beforeEach(() => {
  useLayout.setState({
    sidebar: SIDEBAR_DEFAULT,
    details: 0,
    narrow: false,
    narrowExpanded: false,
  });
});

const get = () => useLayout.getState();

describe("hooks/use-layout sidebar", () => {
  it("宽屏 toggleSidebar：打开/关闭翻转偏好，关闭后重开恢复默认宽", () => {
    get().toggleSidebar();
    expect(get().sidebar).toBe(0);
    get().toggleSidebar();
    expect(get().sidebar).toBe(SIDEBAR_DEFAULT);
  });

  it("窄屏 toggleSidebar 只翻转 narrowExpanded，偏好不被改写", () => {
    useLayout.setState({ narrow: true, narrowExpanded: false });
    get().toggleSidebar();
    expect(get().narrowExpanded).toBe(true);
    expect(get().sidebar).toBe(SIDEBAR_DEFAULT);
    get().toggleSidebar();
    expect(get().narrowExpanded).toBe(false);
    expect(get().sidebar).toBe(SIDEBAR_DEFAULT);
  });

  it("拖拽写入夹进契约范围", () => {
    get().setSidebar(1000);
    expect(get().sidebar).toBe(420);
    get().setSidebar(10);
    expect(get().sidebar).toBe(264);
    get().setSidebar(333.6);
    expect(get().sidebar).toBe(334);
  });

  it("跨越断点任一方向都丢弃 narrowExpanded", () => {
    useLayout.setState({ narrow: true, narrowExpanded: true });
    get().setNarrow(false);
    expect(get().narrow).toBe(false);
    expect(get().narrowExpanded).toBe(false);
    get().setNarrow(true);
    expect(get().narrow).toBe(true);
    expect(get().narrowExpanded).toBe(false);
  });

  it("setNarrow 相同值不产生新状态", () => {
    const before = get();
    get().setNarrow(false);
    expect(get()).toBe(before);
  });
});

describe("hooks/use-layout details", () => {
  it("toggleDetails：关闭/打开翻转，打开恢复默认宽", () => {
    expect(get().details).toBe(0);
    get().toggleDetails();
    expect(get().details).toBe(DETAILS_DEFAULT);
    get().toggleDetails();
    expect(get().details).toBe(0);
  });

  it("openDetails 在已打开时不改写当前拖拽宽度", () => {
    get().openDetails();
    get().setDetails(400);
    get().openDetails();
    expect(get().details).toBe(400);
  });

  it("closeDetails 置 0", () => {
    get().openDetails();
    get().closeDetails();
    expect(get().details).toBe(0);
  });

  it("details 拖拽写入夹进契约范围", () => {
    get().setDetails(10);
    expect(get().details).toBe(300);
    get().setDetails(999);
    expect(get().details).toBe(520);
  });
});

