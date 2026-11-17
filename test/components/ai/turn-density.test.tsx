// @vitest-environment jsdom
// 回合密度守卫：过程日志、已完成任务与多篇引用默认收起，footer 只保留一个操作入口。
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { TurnView } from "@/src/shell/ai/turn";
import { createTurn, type Turn } from "@/src/shell/ai/types";

let container: HTMLDivElement;
let root: Root;

function noop() {}
const confirm = () => Promise.resolve();

function completedTurn(): Turn {
  const turn = createTurn("帮我整理这篇笔记");
  turn.status = "done";
  turn.durationMs = 1200;
  turn.tokens = { input: 12, output: 8 };
  turn.parts = [
    { kind: "tool", seq: 1 },
    { kind: "tool", seq: 2 },
    { kind: "text", text: "已经整理完成。" },
    { kind: "todo" },
  ];
  turn.tools = [
    {
      seq: 1,
      tool: "searchNotes",
      label: "搜索笔记",
      argsText: "{}",
      state: "done",
      summary: "找到 3 篇",
    },
    {
      seq: 2,
      tool: "readNote",
      label: "读取笔记",
      argsText: "{}",
      state: "done",
      summary: "已读取",
    },
  ];
  turn.todos = [
    { content: "读取文档", status: "completed" },
    { content: "整理提纲", status: "completed" },
  ];
  turn.references = [
    { noteId: "n1", title: "周报" },
    { noteId: "n2", title: "项目记录" },
  ];
  return turn;
}

function renderTurn(turn: Turn) {
  act(() => {
    root.render(
      <TurnView
        turn={turn}
        onOpenDocument={noop}
        onConfirmDelete={confirm}
        onCancelDelete={noop}
        onConfirmMove={confirm}
        onCancelMove={noop}
        onConfirmDraft={confirm}
        onDiscardDraft={confirm}
        onAnswerQuestion={noop}
        onRetry={noop}
        onUndo={noop}
        onPreviewChanges={async () => []}
        onEditUser={noop}
        onInsertToDocument={noop}
        onSaveAsNote={noop}
        canInsertToDocument={false}
      />,
    );
  });
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("AI 回合信息密度", () => {
  it("连续工具调用合并成一条默认收起的过程日志", () => {
    renderTurn(completedTurn());
    const summary = [...container.querySelectorAll("summary")].find((item) =>
      item.textContent?.includes("2 项工具操作"),
    );
    expect(summary, "连续工具调用应合并成过程日志").toBeTruthy();
    expect(summary?.parentElement?.hasAttribute("open"), "完成态过程日志应默认收起").toBe(false);
  });

  it("运行中的工具过程自动展开，让用户仍能看到当前步骤", () => {
    const turn = completedTurn();
    turn.status = "running";
    turn.tools = turn.tools.map((card) => ({ ...card, state: "running", summary: "" }));
    renderTurn(turn);
    const summary = [...container.querySelectorAll("summary")].find((item) =>
      item.textContent?.includes("正在执行 2 项操作"),
    );
    expect(summary?.parentElement?.hasAttribute("open")).toBe(true);
  });

  it("已完成任务与多篇引用使用原生 details 按需展开", () => {
    renderTurn(completedTurn());
    const summaries = [...container.querySelectorAll("summary")].map((item) => item.textContent ?? "");
    expect(summaries.some((text) => text.includes("任务清单 · 2/2 已完成"))).toBe(true);
    expect(summaries.some((text) => text.includes("参考了 2 篇笔记"))).toBe(true);
  });

  it("footer 只保留一个操作入口，复制、撤销与运行详情不再平铺", () => {
    renderTurn(completedTurn());
    const footer = container.querySelector("[data-turn-actions]");
    expect(footer?.querySelectorAll("button")).toHaveLength(1);
    expect(footer?.querySelector('button[aria-label="回答操作"]')).not.toBeNull();
    expect(container.textContent).not.toContain("撤销本次改动");
    expect(container.textContent).not.toContain("运行详情");
  });
});
