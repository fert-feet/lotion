// @vitest-environment jsdom
// AI 面板时间线 reducer 单测（P1 批次的防复发核心）：
// 这些规则以前埋在 ai-panel.tsx 的 695 行闭包里（SSE 事件 → turn 状态 / 历史重建 /
// 队列取件），任何一条回归都只能靠手点。现在它们是纯函数，这里逐条钉住。
import { describe, it, expect } from "vitest";
import { createTurn, type SseEvent, type Turn } from "@/src/shell/ai/types";
import {
  applyTurnEvent,
  createQueuedMessage,
  enqueue,
  finalizeTurn,
  markNoteResolved,
  markQuestionAnswered,
  pendingDeleteIds,
  rebuildTurns,
  removeQueueAt,
  shouldDispatchQueued,
  takeNextForSession,
} from "@/src/shell/ai/turn-reducer";
import type { ChatMessage } from "@/lib/seams/doc-store";

const text = (t: string): SseEvent => ({ type: "text", text: t });
const toolStart = (seq: number, tool = "searchNotes"): SseEvent => ({
  type: "tool_start",
  tool,
  seq,
  label: "搜索笔记",
  argsText: '{"query":"x"}',
});
const toolEnd = (seq: number, ok = true, summary = "找到 2 篇"): SseEvent => ({
  type: "tool_end",
  tool: "searchNotes",
  seq,
  ok,
  summary,
  error: ok ? undefined : "boom",
});

function feed(turn: Turn, events: SseEvent[]) {
  const effects = events.flatMap((e) => applyTurnEvent(turn, e));
  return effects;
}

describe("applyTurnEvent：时间线顺序", () => {
  it("文本 → 工具 → 文本 的顺序被保留（旧实现把所有工具卡堆到文本上方）", () => {
    const turn = createTurn("帮我看看");
    feed(turn, [text("好的，"), toolStart(1), text("查到了")]);

    expect(turn.parts.map((p) => p.kind)).toEqual(["text", "tool", "text"]);
    expect(turn.parts[0]).toEqual({ kind: "text", text: "好的，" });
    expect(turn.parts[2]).toEqual({ kind: "text", text: "查到了" });
    expect(turn.text).toBe("好的，查到了");
  });

  it("连续文本 chunk 合并进同一个 part（part 数量不随 chunk 数增长）", () => {
    const turn = createTurn("q");
    feed(turn, [text("一"), text("二"), text("三")]);
    expect(turn.parts).toHaveLength(1);
    expect(turn.text).toBe("一二三");
  });
});

describe("applyTurnEvent：工具卡", () => {
  it("tool_end 回填状态 / 摘要 / 错误详情（错误详情此前被前端丢弃）", () => {
    const turn = createTurn("q");
    feed(turn, [toolStart(7), toolEnd(7, false, "执行失败")]);
    expect(turn.tools[0]).toMatchObject({
      seq: 7,
      state: "error",
      summary: "执行失败",
      error: "boom",
    });
  });

  it("未知 seq 的 tool_end 不抛错、不新增卡片", () => {
    const turn = createTurn("q");
    feed(turn, [toolEnd(99)]);
    expect(turn.tools).toHaveLength(0);
    expect(turn.parts).toHaveLength(0);
  });
});

describe("applyTurnEvent：文档副作用", () => {
  it("note_created → 卡片 + note_created 效果（跳转由组件决定，reducer 不碰路由）", () => {
    const turn = createTurn("q");
    const effects = feed(turn, [{ type: "note_created", noteId: "n1", title: "草稿" }]);
    expect(turn.notes).toEqual([{ kind: "created", noteId: "n1", title: "草稿" }]);
    expect(turn.parts).toEqual([{ kind: "note", index: 0 }]);
    expect(effects).toEqual([{ kind: "note_created", noteId: "n1", title: "草稿" }]);
  });

  it("同一文档的重复 confirm_delete 只留一张待确认卡", () => {
    const turn = createTurn("q");
    feed(turn, [
      { type: "confirm_delete", noteId: "n1", title: "A" },
      { type: "confirm_delete", noteId: "n1", title: "A" },
    ]);
    expect(turn.notes).toHaveLength(1);
  });

  it("已解决的确认卡不再阻塞新的确认（用户拒绝后 AI 可再次请求）", () => {
    const turn = createTurn("q");
    feed(turn, [{ type: "confirm_delete", noteId: "n1", title: "A" }]);
    (turn.notes[0] as { resolved: boolean }).resolved = true;
    feed(turn, [{ type: "confirm_delete", noteId: "n1", title: "A" }]);
    expect(turn.notes).toHaveLength(2);
  });

  it("markNoteResolved 标记解决；没有匹配项时返回原数组（引用不变，省一次渲染）", () => {
    const turn = createTurn("q");
    feed(turn, [{ type: "confirm_move", noteId: "n1", title: "A", targetTitle: "B", toRoot: false }]);
    const resolved = markNoteResolved([turn], "move_confirm", "n1");
    expect((resolved[0].notes[0] as { resolved: boolean }).resolved).toBe(true);
    expect(markNoteResolved(resolved, "move_confirm", "n1")).toBe(resolved);
  });
});

describe("applyTurnEvent：待办 / 提问 / 警告", () => {
  it("todo_update 整体替换且只挂一个 todo part", () => {
    const turn = createTurn("q");
    feed(turn, [
      { type: "todo_update", items: [{ content: "a", status: "pending" }] },
      { type: "todo_update", items: [{ content: "a", status: "completed" }] },
    ]);
    expect(turn.todos).toEqual([{ content: "a", status: "completed" }]);
    expect(turn.parts.filter((p) => p.kind === "todo")).toHaveLength(1);
  });

  it("question 逐条挂卡，且能被回填为已回答（防重复提交同一问题）", () => {
    const turn = createTurn("q");
    feed(turn, [
      {
        type: "question",
        questions: [
          { header: "范围", question: "要包含旧文档吗？", options: [{ label: "要", description: "" }] },
        ],
      },
    ]);
    expect(turn.parts).toEqual([{ kind: "question", index: 0 }]);
    const answered = markQuestionAnswered([turn], turn.id, 0, "要");
    expect(answered[0].questions[0].answered).toBe("要");
  });

  it("warning 同时进时间线与 toast 效果（原来刷新后什么都不剩）", () => {
    const turn = createTurn("q");
    const effects = feed(turn, [{ type: "warning", message: "连续 3 次失败" }]);
    expect(turn.warnings).toEqual(["连续 3 次失败"]);
    expect(turn.parts).toEqual([{ kind: "warning", index: 0 }]);
    expect(effects).toEqual([{ kind: "toast", level: "warning", message: "连续 3 次失败" }]);
  });
});

describe("applyTurnEvent：收尾与失败态", () => {
  it("turn_end 落定耗时与 token，并带上 input tokens", () => {
    const turn = createTurn("q");
    feed(turn, [{ type: "turn_end", turn: 1, durationMs: 1200, tokens: { input: 30, output: 40 } }]);
    expect(turn.status).toBe("done");
    expect(turn.durationMs).toBe(1200);
    expect(turn.tokens).toEqual({ input: 30, output: 40 });
  });

  it("error 置失败态；随后的 turn_end 不把它翻回 done（doom loop 终止路径）", () => {
    const turn = createTurn("q");
    const effects = feed(turn, [
      { type: "error", message: "重复工具调用已终止" },
      { type: "turn_end", turn: 1, durationMs: 900, tokens: null },
    ]);
    expect(turn.status).toBe("error");
    expect(turn.errorMessage).toBe("重复工具调用已终止");
    expect(turn.durationMs).toBe(900);
    expect(effects).toEqual([{ kind: "toast", level: "error", message: "重复工具调用已终止" }]);
  });

  it("finalizeTurn 只收尾 running 的回合；已有结局的回合不被覆盖", () => {
    const running = createTurn("q");
    finalizeTurn(running, "error", "AI 请求失败，请稍后再试");
    expect(running.status).toBe("error");
    expect(running.errorMessage).toBe("AI 请求失败，请稍后再试");
    expect(running.durationMs).toBeGreaterThanOrEqual(0);

    const done = createTurn("q");
    done.status = "done";
    done.durationMs = 42;
    finalizeTurn(done, "error", "不该覆盖");
    expect(done.status).toBe("done");
    expect(done.durationMs).toBe(42);
  });
});

describe("rebuildTurns：扁平消息 → 时间线", () => {
  const msg = (role: "user" | "assistant", content: string): ChatMessage => ({
    id: role + content,
    role,
    content,
    createdAt: "2024-01-01T00:00:00.000Z",
  });

  it("user 开一轮、assistant 归入上一轮；耗时未知时不写 0（曾渲染成『耗时 0ms』）", () => {
    const turns = rebuildTurns([msg("user", "问 1"), msg("assistant", "答 1"), msg("user", "问 2")]);
    expect(turns).toHaveLength(2);
    expect(turns[0].userContent).toBe("问 1");
    expect(turns[0].text).toBe("答 1");
    expect(turns[0].parts).toEqual([{ kind: "text", text: "答 1" }]);
    expect(turns[0].durationMs).toBeNull();
    expect(turns[1].status).toBe("done");
    expect(turns[1].text).toBe("");
  });

  it("缺少 user 前导的 assistant 消息被忽略（不产生孤儿回合）", () => {
    expect(rebuildTurns([msg("assistant", "孤儿")])).toHaveLength(0);
  });

  it("停止生成留下的空 assistant 消息不会伪造出文本 part", () => {
    const turns = rebuildTurns([msg("user", "问"), msg("assistant", "")]);
    expect(turns[0].parts).toEqual([{ kind: "text", text: "" }]);
    expect(turns[0].text).toBe("");
  });
});

describe("rebuildTurns：快照恢复", () => {
  const assistantMsg = (content: string, metadata: unknown, tokens = true): ChatMessage => ({
    id: "m-" + content,
    role: "assistant",
    content,
    createdAt: "2024-01-01T00:00:00.000Z",
    metadata: typeof metadata === "string" ? metadata : JSON.stringify(metadata),
    promptTokens: tokens ? 11 : undefined,
    completionTokens: tokens ? 22 : undefined,
  });
  const userMsg = (content: string): ChatMessage => ({
    id: "u-" + content,
    role: "user",
    content,
    createdAt: "2024-01-01T00:00:00.000Z",
  });

  it("工具卡 / 引用 / 待办 / 提问 / 警告 / 耗时 / token 全部恢复，part 顺序与实时一致", () => {
    const content = "先查一下，";
    const snapshot = {
      version: 1,
      durationMs: 4321,
      errorMessage: null,
      parts: [
        { kind: "text", chars: 3 }, // "先查一"
        { kind: "tool", seq: 1 },
        { kind: "text", chars: 2 }, // "下，"
        { kind: "warning", index: 0 },
        { kind: "todo" },
        { kind: "note", index: 0 },
      ],
      tools: [{ seq: 1, tool: "searchNotes", label: "搜索笔记", argsText: "{}", state: "done", summary: "找到 2 篇" }],
      notes: [{ kind: "created", noteId: "n1", title: "草稿" }],
      references: [{ noteId: "n1", title: "草稿" }],
      questions: [],
      todos: [{ content: "写摘要", status: "completed" }],
      warnings: ["连续 3 次失败"],
    };

    const [turn] = rebuildTurns([userMsg("总结"), assistantMsg(content, snapshot)]);
    expect(turn.parts.map((p) => p.kind)).toEqual(["text", "tool", "text", "warning", "todo", "note"]);
    expect(turn.parts[0]).toEqual({ kind: "text", text: "先查一" });
    expect(turn.parts[2]).toEqual({ kind: "text", text: "下，" });
    expect(turn.text).toBe(content);
    expect(turn.tools[0].summary).toBe("找到 2 篇");
    expect(turn.references).toEqual([{ noteId: "n1", title: "草稿" }]);
    expect(turn.todos).toEqual([{ content: "写摘要", status: "completed" }]);
    expect(turn.warnings).toEqual(["连续 3 次失败"]);
    expect(turn.durationMs).toBe(4321);
    expect(turn.tokens).toEqual({ input: 11, output: 22 });
    expect(turn.status).toBe("done");
  });

  it("待确认的删除卡刷新后仍在（此前切会话就静默消失，用户永远确认不了）", () => {
    const snapshot = {
      version: 1,
      durationMs: 10,
      errorMessage: null,
      parts: [{ kind: "note", index: 0 }],
      notes: [{ kind: "delete_confirm", noteId: "n1", title: "旧笔记", resolved: false }],
      tools: [],
      references: [],
      questions: [],
      todos: [],
      warnings: [],
    };
    const [turn] = rebuildTurns([userMsg("删了它"), assistantMsg("", snapshot, false)]);
    expect(turn.notes).toEqual([
      { kind: "delete_confirm", noteId: "n1", title: "旧笔记", resolved: false },
    ]);
  });

  it("失败轮次刷新后仍是失败态（errorMessage 一起恢复）", () => {
    const snapshot = {
      version: 1,
      durationMs: 900,
      errorMessage: "AI 请求失败，请稍后再试",
      parts: [{ kind: "text", chars: 0 }],
      tools: [],
      notes: [],
      references: [],
      questions: [],
      todos: [],
      warnings: [],
    };
    const [turn] = rebuildTurns([userMsg("问"), assistantMsg("", snapshot)]);
    expect(turn.status).toBe("error");
    expect(turn.errorMessage).toBe("AI 请求失败，请稍后再试");
  });

  it("快照文本段与正文长度不一致时补末尾文本段（中止/版本漂移也不丢字）", () => {
    const snapshot = {
      version: 1,
      durationMs: null,
      errorMessage: null,
      parts: [{ kind: "text", chars: 2 }],
      tools: [],
      notes: [],
      references: [],
      questions: [],
      todos: [],
      warnings: [],
    };
    const [turn] = rebuildTurns([userMsg("问"), assistantMsg("前两个字后面还有", snapshot)]);
    expect(turn.parts).toEqual([{ kind: "text", text: "前两个字后面还有" }]);
  });

  it("快照损坏（坏 JSON）时降级为纯文本，不抛异常", () => {
    const [turn] = rebuildTurns([userMsg("问"), assistantMsg("回答", "{坏掉的 JSON")]);
    expect(turn.parts).toEqual([{ kind: "text", text: "回答" }]);
    expect(turn.status).toBe("done");
  });

  it("恢复 changedDocuments 与 requestId（刷新后撤销按钮仍可用）", () => {
    const snapshot = {
      version: 1,
      durationMs: 5,
      errorMessage: null,
      changedDocuments: ["n1", "n2"],
      requestId: "req-42",
      parts: [{ kind: "text", chars: 0 }],
      tools: [],
      notes: [],
      references: [],
      questions: [],
      todos: [],
      warnings: [],
    };
    const [turn] = rebuildTurns([userMsg("改两篇"), assistantMsg("", snapshot, false)]);
    expect(turn.changedDocuments).toEqual(["n1", "n2"]);
    expect(turn.requestId).toBe("req-42");
    expect(turn.undone).toBeUndefined();
  });

  it("实时事件里的 note_modified 立即记入 changedDocuments（不用等落库）", () => {
    const turn = createTurn("改一下");
    feed(turn, [
      { type: "note_modified", noteId: "n1", title: "A" },
      { type: "note_modified", noteId: "n1", title: "A" },
      { type: "note_modified", noteId: "n2", title: "B" },
    ]);
    expect(turn.changedDocuments).toEqual(["n1", "n2"]);
  });

  it("提问卡的回答状态被恢复（刷新后不会重复回答同一问题）", () => {
    const snapshot = {
      version: 1,
      durationMs: 1,
      errorMessage: null,
      parts: [{ kind: "question", index: 0 }],
      tools: [],
      notes: [],
      references: [],
      questions: [
        {
          header: "范围",
          question: "包含旧文档吗？",
          options: [{ label: "要", description: "" }],
          answered: "要",
        },
      ],
      todos: [],
      warnings: [],
    };
    const [turn] = rebuildTurns([userMsg("问"), assistantMsg("", snapshot, false)]);
    expect(turn.questions[0].answered).toBe("要");
  });
});

describe("发送队列：按会话取件", () => {
  it("只取当前会话的消息，且保持 FIFO；其他会话的消息留在队列里", () => {
    const a1 = createQueuedMessage("A1", "s1");
    const b1 = createQueuedMessage("B1", "s2");
    const a2 = createQueuedMessage("A2", "s1");
    const queue = enqueue(enqueue(enqueue([], a1), b1), a2);

    const first = takeNextForSession(queue, "s1");
    expect(first.item?.content).toBe("A1");
    expect(first.rest.map((q) => q.content)).toEqual(["B1", "A2"]);

    // 切到 s2：拿到 B1，A2 仍留给 s1
    const second = takeNextForSession(first.rest, "s2");
    expect(second.item?.content).toBe("B1");
    expect(second.rest.map((q) => q.content)).toEqual(["A2"]);

    // 队列里没有本会话的消息时：原样返回（不误发别人的）
    const none = takeNextForSession(second.rest, "s3");
    expect(none.item).toBeNull();
    expect(none.rest).toEqual(second.rest);
  });

  it("sessionId 为空时不动队列", () => {
    const queue = [createQueuedMessage("A", "s1")];
    expect(takeNextForSession(queue, null)).toEqual({ item: null, rest: queue });
  });

  it("相同内容的两条消息 id 不同（key 不再撞车），移除按下标生效", () => {
    const q1 = createQueuedMessage("同样的话", "s1");
    const q2 = createQueuedMessage("同样的话", "s1");
    expect(q1.id).not.toBe(q2.id);
    const queue = enqueue(enqueue([], q1), q2);
    expect(removeQueueAt(queue, 0)).toEqual([q2]);
  });
});

describe("pendingDeleteIds：刷新后的删除对账", () => {
  it("收集未解决的删除确认（去重），忽略已解决与其他类型", () => {
    const a = createTurn("a");
    feed(a, [
      { type: "confirm_delete", noteId: "n1", title: "A" },
      { type: "confirm_delete", noteId: "n2", title: "B" },
      { type: "confirm_move", noteId: "n3", title: "C", targetTitle: null, toRoot: true },
    ]);
    const b = createTurn("b");
    feed(b, [{ type: "confirm_delete", noteId: "n1", title: "A" }]);
    const resolved = markNoteResolved([b], "delete_confirm", "n1");

    expect(pendingDeleteIds([...resolved, a])).toEqual(["n1", "n2"]);
    expect(pendingDeleteIds([])).toEqual([]);
  });
});

describe("rebuildTurns：用户消息的附件清单", () => {
  it("从用户消息 metadata 恢复附件 chip（正文不落库）", () => {
    const turns = rebuildTurns([
      {
        id: "u1",
        role: "user",
        content: "看看这个",
        createdAt: "2024-01-01T00:00:00.000Z",
        metadata: JSON.stringify({ attachments: [{ name: "周报.md", size: 1200 }] }),
      },
      { id: "a1", role: "assistant", content: "好的", createdAt: "2024-01-01T00:00:01.000Z" },
    ]);
    expect(turns[0].attachments).toEqual([{ name: "周报.md", size: 1200 }]);
  });

  it("metadata 缺失/损坏时不显示附件，也不抛异常", () => {
    const [turn] = rebuildTurns([
      { id: "u1", role: "user", content: "hi", createdAt: "x", metadata: "{坏" },
    ]);
    expect(turn.attachments).toEqual([]);
  });
});

describe("shouldDispatchQueued：停止后不再自动续发", () => {
  const queue = [createQueuedMessage("排队的话", "s1")];

  it("正常结束：有本会话的待发消息就发", () => {
    expect(shouldDispatchQueued({ streaming: false, suppressed: false }, queue, "s1")).toBe(true);
  });

  it("用户点过「停止生成」：不自动续发（否则像是中断无效，它又自己开始思考）", () => {
    expect(shouldDispatchQueued({ streaming: false, suppressed: true }, queue, "s1")).toBe(false);
  });

  it("仍在生成中 / 没有本会话的待发消息 → 不发", () => {
    expect(shouldDispatchQueued({ streaming: true, suppressed: false }, queue, "s1")).toBe(false);
    expect(shouldDispatchQueued({ streaming: false, suppressed: false }, queue, "s2")).toBe(false);
    expect(shouldDispatchQueued({ streaming: false, suppressed: false }, [], "s1")).toBe(false);
  });
});
