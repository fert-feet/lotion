// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SidebarDocument } from "@/lib/seams/doc-store";
import { MoveDocDialog } from "@/src/shell/sidebar/move-doc-dialog";

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  document.body.querySelectorAll('[role="dialog"]').forEach((node) => node.remove());
  root = null;
  host = null;
});

function doc(id: string, parentDocument: string | null = null): SidebarDocument {
  return {
    id,
    title: id,
    userId: "u1",
    isArchived: false,
    isDraft: false,
    parentDocument,
    icon: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("MoveDocDialog", () => {
  it("排除自身与子孙，并提交选定父页面", async () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const onMove = vi.fn();
    const docs = [doc("a"), doc("a1", "a"), doc("a1x", "a1"), doc("b")];

    await act(async () => {
      root!.render(
        <MoveDocDialog
          docs={docs}
          documentId="a1"
          open
          onOpenChange={() => {}}
          onMove={onMove}
        />,
      );
    });

    const radios = [...document.querySelectorAll<HTMLElement>('[role="radio"]')];
    expect(radios.map((radio) => radio.textContent?.trim())).toEqual(["根目录", "a", "b"]);
    await act(async () => {
      radios[2].click();
    });
    const move = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.trim() === "移动",
    );
    await act(async () => {
      move!.click();
    });
    expect(onMove).toHaveBeenCalledWith("a1", "b");
  });
});
