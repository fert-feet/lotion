// @vitest-environment jsdom
// Slot（asChild）与对话框按钮的防复发测试。
//
// 事故背景：AlertDialogAction/Cancel 默认 asChild，但 ConfirmModal 里直接写文本子节点
// （<AlertDialogCancel>Cancel</AlertDialogCancel>）。旧 Slot 用 Children.only + isValidElement
// 判断，遇到字符串子节点直接 `return null` —— 按钮**静默消失**，确认框只剩标题与描述。
// 现在 Slot 会兜底渲染原生 button，并带上 Apple 按钮样式。
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Slot } from "@/components/ui/_primitives";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("Slot（asChild 语义）", () => {
  it("子节点是元素时合并 props 到该元素，不额外包一层", () => {
    act(() => {
      root.render(
        <Slot className="x" data-testid="child">
          <span>内容</span>
        </Slot>,
      );
    });
    const el = container.querySelector("[data-testid='child']");
    expect(el?.tagName).toBe("SPAN");
    expect(el?.className).toContain("x");
  });

  it("子节点是纯文本时兜底渲染 button，而不是静默返回 null", () => {
    act(() => {
      root.render(<Slot className="y">取消</Slot>);
    });
    const btn = container.querySelector("button");
    expect(btn, "文本子节点被丢弃会让按钮凭空消失").not.toBeNull();
    expect(btn!.textContent).toBe("取消");
    expect(btn!.className).toContain("y");
  });
});

describe("AlertDialog 按钮", () => {
  it("文本子节点的 Action / Cancel 都会真实渲染（含 Apple 按钮样式）", () => {
    act(() => {
      root.render(
        <AlertDialog open onOpenChange={() => {}}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>确定删除？</AlertDialogTitle>
              <AlertDialogDescription>此操作不可撤销。</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              <AlertDialogAction>确认</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>,
      );
    });

    const buttons = [...document.querySelectorAll("button")];
    const texts = buttons.map((b) => b.textContent?.trim());
    expect(texts).toContain("取消");
    expect(texts).toContain("确认");

    const cancel = buttons.find((b) => b.textContent?.trim() === "取消")!;
    const confirm = buttons.find((b) => b.textContent?.trim() === "确认")!;
    // 取消 = 灰色次按钮，确认 = 系统蓝主按钮
    expect(cancel.className).toContain("bg-secondary");
    expect(confirm.className).toContain("bg-primary");
    expect(confirm.className).toContain("rounded-[7px]");
  });
});
