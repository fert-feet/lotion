// @vitest-environment jsdom
// Slot（asChild）与对话框按钮的防复发测试。
//
// 事故背景：AlertDialogAction/Cancel 默认 asChild，但 ConfirmModal 里直接写文本子节点
// （<AlertDialogCancel>Cancel</AlertDialogCancel>）。旧 Slot 用 Children.only + isValidElement
// 判断，遇到字符串子节点直接 `return null` —— 按钮**静默消失**，确认框只剩标题与描述。
// 现在 Slot 会兜底渲染原生 button，并带上 Apple 按钮样式。
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Slot } from "@/components/ui/_primitives";
import ConfirmModal from "@/components/modals/confirm-modal";
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

  it("子元素自带 className 时与槽位 className 相加，而不是整串覆盖", () => {
    act(() => {
      root.render(
        <Slot className="absolute right-3.5 top-3.5" onClick={() => {}}>
          <span className="h-3.5 w-3.5">×</span>
        </Slot>,
      );
    });
    const el = container.querySelector("span")!;
    // 事故背景：关闭按钮写成 <DialogClose className="absolute right-3.5 …"><X className="h-3.5 w-3.5" /></DialogClose>，
    // 子元素的 className 覆盖掉了槽位的绝对定位 → X 掉进文档流、挤在弹窗左上角被圆角切掉。
    expect(el.className).toContain("absolute");
    expect(el.className).toContain("right-3.5");
    expect(el.className).toContain("h-3.5");
  });

  it("槽位与子元素都挂了同一个事件时依次触发，不吞掉任何一方", () => {
    const calls: string[] = [];
    act(() => {
      root.render(
        <Slot onClick={() => calls.push("slot")}>
          <button type="button" onClick={() => calls.push("child")}>
            点我
          </button>
        </Slot>,
      );
    });
    act(() => {
      container.querySelector("button")!.click();
    });
    expect(calls).toEqual(["child", "slot"]);
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
    expect(confirm.className).toContain("rounded-control");
  });
});

describe("ConfirmModal（销毁类确认）", () => {
  const open = (node: ReactNode) => {
    act(() => root.render(node));
    act(() => {
      container.querySelector("button")!.click();
    });
  };

  it("默认文案是中文，主按钮是 destructive 而不是系统蓝", () => {
    open(
      <ConfirmModal onConfirm={() => {}}>
        <button type="button">永久删除</button>
      </ConfirmModal>,
    );

    // 事故背景：全站唯一的"永久删除"确认框是英文（Are you absolutely sure? / Cancel / Confirm），
    // 主按钮还是 systemBlue —— 危险动作看起来像普通保存。
    const text = document.body.textContent ?? "";
    expect(text).toContain("确定要删除吗？");
    expect(text).toContain("此操作无法撤销。");
    expect(text).not.toContain("Are you absolutely sure?");
    expect(text).not.toContain("Confirm");

    const buttons = [...document.querySelectorAll("button")];
    const confirm = buttons.find((b) => b.textContent?.trim() === "删除");
    expect(confirm, "删除键应存在").not.toBeUndefined();
    expect(confirm!.className).toContain("bg-destructive");
    expect(confirm!.className).not.toContain("bg-primary");
    expect(buttons.some((b) => b.textContent?.trim() === "取消")).toBe(true);
  });

  it("危险确认使用紧凑弹窗、左对齐信息和独立操作栏", () => {
    open(
      <ConfirmModal onConfirm={() => {}}>
        <button type="button">永久删除</button>
      </ConfirmModal>,
    );

    const panel = document.querySelector<HTMLElement>('[role="alertdialog"]');
    expect(panel?.className).toContain("max-w-sm");
    expect(panel?.firstElementChild?.className).toContain("text-left");
    expect(panel?.lastElementChild?.className).toContain("hairline-t");
    for (const button of panel?.querySelectorAll("button") ?? []) {
      expect(button.className).toContain("min-w-20");
    }
  });

  it("调用方可点名对象并改写后果说明", () => {
    open(
      <ConfirmModal
        onConfirm={() => {}}
        title="永久删除「周报」？"
        description="不会进入回收站，删除后无法恢复。"
        confirmText="永久删除"
      >
        <button type="button">永久删除</button>
      </ConfirmModal>,
    );

    const text = document.body.textContent ?? "";
    expect(text).toContain("永久删除「周报」？");
    expect(text).toContain("不会进入回收站，删除后无法恢复。");
    const matches = [...document.querySelectorAll("button")].filter((b) => b.textContent?.trim() === "永久删除");
    // 触发器和确认键同名：触发器在容器内，弹窗经 portal 挂在 body 末尾 → 取最后一个
    const action = matches[matches.length - 1]!;
    expect(matches.length).toBe(2);
    expect(action.className).toContain("bg-destructive");
  });
});
