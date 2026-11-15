// @vitest-environment jsdom
// 文档自动保存：成功清理恢复稿、失败保留并可重试、离开页面时同步留恢复稿。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  useDocumentAutosave,
  type DocumentSaveStatus,
} from "@/hooks/use-document-autosave";

type Autosave = ReturnType<typeof useDocumentAutosave>;

let container: HTMLDivElement;
let root: Root | null;
let current: Autosave | null;

function Harness({
  storageKey,
  save,
}: {
  storageKey: string;
  save: (value: string) => Promise<void>;
}) {
  current = useDocumentAutosave({ storageKey, delay: 800, save });
  return (
    <output data-status={current.status} data-error={current.error ?? ""}>
      {current.recovery ?? ""}
    </output>
  );
}

function status(): DocumentSaveStatus {
  return container.querySelector("output")!.dataset.status as DocumentSaveStatus;
}

beforeEach(() => {
  const store = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, String(value)),
      removeItem: (key: string) => void store.delete(key),
      clear: () => void store.clear(),
    },
  });
  current = null;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  container?.remove();
  vi.useRealTimers();
});

describe("useDocumentAutosave", () => {
  it("成功保存后进入 saved 并清除本地恢复稿", async () => {
    const save = vi.fn(async () => {});
    act(() => root!.render(<Harness storageKey="lotion:test:content" save={save} />));

    await act(async () => {
      current!.schedule("正文草稿");
      await current!.flush();
    });

    expect(save).toHaveBeenCalledWith("正文草稿");
    expect(status()).toBe("saved");
    expect(window.localStorage.getItem("lotion:test:content")).toBeNull();
  });

  it("失败时保留恢复稿，重试成功后转为 saved", async () => {
    const save = vi
      .fn<(value: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error("网络断开"))
      .mockResolvedValueOnce(undefined);
    act(() => root!.render(<Harness storageKey="lotion:test:content" save={save} />));

    await act(async () => {
      current!.schedule("尚未保存");
      await current!.flush();
    });
    expect(status()).toBe("error");
    expect(container.querySelector("output")!.dataset.error).toContain("网络断开");
    expect(window.localStorage.getItem("lotion:test:content")).toBe("尚未保存");

    await act(async () => {
      await current!.retry();
    });
    expect(save).toHaveBeenCalledTimes(2);
    expect(status()).toBe("saved");
    expect(window.localStorage.getItem("lotion:test:content")).toBeNull();
  });

  it("离开页面前同步写恢复稿并阻止无提示关闭", () => {
    act(() =>
      root!.render(<Harness storageKey="lotion:test:content" save={vi.fn(async () => {})} />),
    );
    act(() => current!.schedule("离开前的内容"));

    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(window.localStorage.getItem("lotion:test:content")).toBe("离开前的内容");
  });

  it("文档切换后读取新字段自己的恢复稿", () => {
    window.localStorage.setItem("lotion:test:title", "另一篇的恢复标题");
    act(() =>
      root!.render(<Harness storageKey="lotion:test:content" save={vi.fn(async () => {})} />),
    );
    act(() =>
      root!.render(<Harness storageKey="lotion:test:title" save={vi.fn(async () => {})} />),
    );

    expect(container.querySelector("output")!.textContent).toBe("另一篇的恢复标题");
    expect(status()).toBe("idle");
  });
});
