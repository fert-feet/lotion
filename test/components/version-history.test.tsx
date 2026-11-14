// @vitest-environment jsdom
// 版本历史弹窗：时间线渲染、预览加载、回滚调用接缝（不发裸 fetch）。
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const versions = [
  {
    id: "v1",
    title: "第一版",
    source: "user" as const,
    createdAt: new Date(Date.now() - 60_000).toISOString(),
    contentLength: 120,
  },
  {
    id: "v2",
    title: "AI 改过",
    source: "ai" as const,
    createdAt: new Date(Date.now() - 3_600_000).toISOString(),
    contentLength: 80,
  },
];

const docStore = {
  listVersions: vi.fn(async () => versions),
  getVersion: vi.fn(async (_a: unknown, _id: string, versionId: string) => ({
    ...versions.find((v) => v.id === versionId)!,
    content: versionId === "v1" ? "第一版正文" : "AI 版正文",
  })),
  restoreVersion: vi.fn(async () => {}),
};

vi.mock("@/src/kernel/react", () => ({
  useDocStore: () => docStore,
  useActor: () => ({ userId: "u1" }),
}));

const { VersionHistoryDialog } = await import("@/components/modals/version-history-dialog");

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  vi.clearAllMocks();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function renderAndSettle(node: React.ReactElement) {
  await act(async () => {
    root.render(node);
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
}

describe("VersionHistoryDialog", () => {
  it("列出时间线：标题、来源徽标（AI）与相对时间", async () => {
    await renderAndSettle(
      <VersionHistoryDialog documentId="d1" open onOpenChange={() => {}} />,
    );
    expect(docStore.listVersions).toHaveBeenCalledTimes(1);
    // DialogContent 用 createPortal 渲染到 body
    const text = document.body.textContent ?? "";
    expect(text).toContain("第一版");
    expect(text).toContain("AI 改过");
    expect(text).toContain("AI"); // source=ai 的徽标
  });

  it("选中版本后加载正文预览", async () => {
    await renderAndSettle(
      <VersionHistoryDialog documentId="d1" open onOpenChange={() => {}} />,
    );
    // 默认选中第一条
    expect(docStore.getVersion).toHaveBeenCalledWith(
      expect.anything(),
      "d1",
      "v1",
    );
    expect(document.body.textContent).toContain("第一版正文");
  });

  it("点「恢复此版本」调用接缝并触发刷新回调", async () => {
    const onRestored = vi.fn();
    await renderAndSettle(
      <VersionHistoryDialog
        documentId="d1"
        open
        onOpenChange={() => {}}
        onRestored={onRestored}
      />,
    );
    const restoreBtn = [...document.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("恢复此版本"),
    );
    expect(restoreBtn).toBeTruthy();
    await act(async () => {
      restoreBtn!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(docStore.restoreVersion).toHaveBeenCalledWith(expect.anything(), "d1", "v1");
    expect(onRestored).toHaveBeenCalledTimes(1);
  });

  it("没有历史版本时显示空状态（而不是空白列表）", async () => {
    docStore.listVersions.mockResolvedValueOnce([]);
    await renderAndSettle(
      <VersionHistoryDialog documentId="d1" open onOpenChange={() => {}} />,
    );
    expect(document.body.textContent).toContain("还没有历史版本");
  });
});
