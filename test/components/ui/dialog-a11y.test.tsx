// @vitest-environment jsdom
// 浮层的语义与焦点守卫。
//
// 事故背景：Dialog / AlertDialog / Popover 三套浮层此前只有 Escape，
// 面板上没有 role/aria-modal/aria-labelledby，打开不聚焦、Tab 会跑出弹窗、
// 关闭后焦点丢在 body 上 —— 读屏只念一个没有名字的「对话框」，键盘用户回不到触发按钮。
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

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

function render(node: React.ReactNode) {
  act(() => root.render(node));
}

function click(el: Element) {
  act(() => {
    (el as HTMLElement).click();
  });
}

/** 打开后的 portal 节点在 body 上，与 container 同级 */
function q<T extends Element = HTMLElement>(selector: string): T | null {
  return document.body.querySelector<T>(selector);
}

describe("Dialog 语义", () => {
  it("面板带 role=dialog / aria-modal，并由标题命名", () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>设置</DialogTitle>
          <DialogDescription>说明</DialogDescription>
        </DialogContent>
      </Dialog>,
    );

    const panel = q('[role="dialog"]');
    expect(panel, "面板没有 dialog 语义，读屏无法识别为对话框").not.toBeNull();
    expect(panel!.getAttribute("aria-modal")).toBe("true");
    expect(panel!.getAttribute("tabindex")).toBe("-1");

    const labelledBy = panel!.getAttribute("aria-labelledby");
    expect(labelledBy, "aria-labelledby 缺失 → 读屏念不出对话框的名字").toBeTruthy();
    expect(panel!.querySelector(`#${labelledBy}`)?.textContent).toBe("设置");
  });

  it("打开后焦点进入面板，关闭后退还给触发按钮", () => {
    render(
      <Dialog>
        <DialogTrigger asChild={false}>打开</DialogTrigger>
        <DialogContent>
          <DialogTitle>设置</DialogTitle>
          <button type="button">确定</button>
        </DialogContent>
      </Dialog>,
    );

    const trigger = container.querySelector("button")!;
    trigger.focus();
    click(trigger);

    const panel = q('[role="dialog"]')!;
    expect(panel.contains(document.activeElement), "打开后焦点没有进入弹窗").toBe(true);

    click(q('[aria-label="关闭"]')!);
    expect(q('[role="dialog"]')).toBeNull();
    expect(document.activeElement, "关闭后焦点应回到触发按钮").toBe(trigger);
  });
});

describe("AlertDialog 语义", () => {
  it("面板用 role=alertdialog 并由标题命名", () => {
    render(
      <AlertDialog open>
        <AlertDialogContent>
          <AlertDialogTitle>永久删除这篇笔记？</AlertDialogTitle>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction variant="destructive">删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>,
    );

    const panel = q('[role="alertdialog"]');
    expect(panel, "销毁类确认框必须是 alertdialog 而不是普通 dialog").not.toBeNull();
    expect(panel!.getAttribute("aria-modal")).toBe("true");
    const labelledBy = panel!.getAttribute("aria-labelledby");
    expect(panel!.querySelector(`#${labelledBy}`)?.textContent).toBe("永久删除这篇笔记？");
  });
});

describe("Popover 语义", () => {
  it("浮层面板有 role=dialog 与可访问名字", () => {
    render(
      <Popover open>
        <PopoverTrigger>回收站</PopoverTrigger>
        <PopoverContent aria-label="回收站">
          <button type="button">恢复</button>
        </PopoverContent>
      </Popover>,
    );

    const panel = q('[role="dialog"]');
    expect(panel, "浮层内容没有 dialog 语义").not.toBeNull();
    expect(panel!.getAttribute("aria-label")).toBe("回收站");
    expect(panel!.contains(document.activeElement), "打开浮层后焦点应进入面板").toBe(true);
  });
});
