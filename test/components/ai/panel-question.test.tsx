// @vitest-environment jsdom
// 「AI 向用户提问 → 用户作答」这条链的集成测试（真实挂载路由 + 真实 SSE 解析）。
//
// 事故背景（用户报："给完答案后就没反应了"）：
//   QuestionCard 的作答回调是 `useCallback(…, [])`，里面直接调用 handleSend ——
//   而 handleSend 捕获 activeSessionId（首帧是 null）。空依赖把**首次渲染**的闭包
//   永久冻住，于是 handleSend 开头 `if (!content || !activeSessionId) return` 静默返回：
//   卡片被 markQuestionAnswered 改成「已回答」（界面看起来像发生了什么），
//   请求却根本没发出去，对话就停在那里等一个永远不来的回复。
//
// 为什么原有测试没发现：turn-reducer.test.ts 只覆盖 reducer 的状态流转
// （markQuestionAnswered 把卡片改成已回答），**没有任何用例断言作答真的发出了请求**。
// 状态对了、网络请求没了 —— 测试全绿。本文件补的就是这一段。
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { UserProvider } from "@/hooks/use-user";
import { routes } from "@/src/router";
import { useLayout } from "@/hooks/use-layout";
import { KernelProvider } from "@/src/kernel/react";
import { shellUiPlugins } from "@/src/shell/ui-plugins";
import { getClientKernel } from "@/src/kernel/client";

let container: HTMLDivElement;
let root: Root;
const encoder = new TextEncoder();

/** 提问卡片的内容（选项走点击路径，custom 走输入路径，两条都覆盖） */
const QUESTION = {
  header: "范围",
  question: "要包含旧文档吗？",
  options: [
    { label: "包含旧文档", description: "把归档的也算进来" },
    { label: "只看新文档", description: "忽略归档内容" },
  ],
};

interface RecordedCall {
  url: string;
  method: string;
  body: string;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

/** 造一条真实 SSE 响应（与 server 输出逐字一致：data: <json>\n\n） */
function sseResponse(events: object[]) {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const event of events) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        }
        controller.close();
      },
    }),
    { status: 200, headers: { "content-type": "text/event-stream; charset=utf-8" } },
  );
}

/** 记录到 /api/ai/chat 的每一次请求（断言"作答真的发出去了"就靠它） */
function chatCalls(): RecordedCall[] {
  return (globalThis as { __chatCalls?: RecordedCall[] }).__chatCalls ?? [];
}

/**
 * 分派 API。第一次 /api/ai/chat 回一个带 question 事件的流（模拟 AI 提问），
 * 之后的调用回普通文本流 —— 这样"作答是否又发了一次请求"可以被精确断言。
 */
function mockApi() {
  const chats: RecordedCall[] = [];
  (globalThis as { __chatCalls?: RecordedCall[] }).__chatCalls = chats;
  let chatCount = 0;

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (url.includes("/api/me")) return json({ user: { id: "u1", email: "u@x.com", name: null } });

      if (url.includes("/api/ai/chat")) {
        chats.push({ url, method, body: String(init?.body ?? "") });
        chatCount += 1;
        const events =
          chatCount === 1
            ? [
                { type: "turn_start", turn: 1, startedAt: new Date().toISOString() },
                { type: "text", text: "好的，不过还差关键信息：" },
                { type: "question", questions: [QUESTION] },
                { type: "turn_end", turn: 1, durationMs: 12, tokens: { input: 3, output: 9 } },
              ]
            : [
                { type: "turn_start", turn: 2, startedAt: new Date().toISOString() },
                { type: "text", text: "收到，我这就写。" },
                { type: "turn_end", turn: 2, durationMs: 10, tokens: { input: 4, output: 5 } },
              ];
        return sseResponse(events);
      }

      if (url.includes("/api/chat/sessions") && method === "POST") return json({ id: "s1" });
      if (url.includes("/api/chat/sessions") && url.includes("/messages")) return json([]);
      if (url.includes("/api/chat/sessions")) {
        return json([{ id: "s1", title: "新对话", createdAt: "", updatedAt: "" }]);
      }
      return json([]);
    }),
  );
}

async function mountPanel() {
  const router = createMemoryRouter(routes, { initialEntries: ["/documents"] });
  await act(async () => {
    root.render(
      <ThemeProvider attribute="class" defaultTheme="light" storageKey="t">
        {/* 与 src/app.tsx 同构：内核 + 内置 UI 插件（details 面板由 ui-slots 贡献） */}
        <KernelProvider options={{ extraPlugins: shellUiPlugins() }}>
          <UserProvider initialUser={null}>
            <RouterProvider router={router} />
          </UserProvider>
        </KernelProvider>
      </ThemeProvider>,
    );
  });
  await act(async () => {
    const ready = await Promise.race([
      getClientKernel().ready.then(() => "ready"),
      new Promise((r) => setTimeout(() => r("timeout"), 800)),
    ]);
    if (ready === "timeout") throw new Error("客户端内核 800ms 内未就绪（测试环境问题）");
    await new Promise((r) => setTimeout(r, 60));
  });
  // 打开 details 列（AI 面板；懒加载 chunk，轮询等它落地）
  await act(async () => {
    useLayout.getState().openDetails();
  });
  for (let i = 0; i < 40; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 25));
    });
    if (document.querySelector('[aria-label^="输入"]')) break;
  }
  return router;
}

/** 找到 AI 面板的输入框（contentEditable + role=textbox）并发一条消息 */
async function sendMessage(text: string) {
  const editor = document.querySelector<HTMLElement>('[aria-label^="输入你的问题"], [aria-label^="输入消息"]');
  expect(editor, "AI 面板的输入框没渲染出来").not.toBeNull();
  await act(async () => {
    editor!.textContent = text;
    editor!.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    editor!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );
  });
}

/** 等提问卡片出现（SSE 落地 + 渲染提交） */
async function waitForQuestionCard() {
  for (let i = 0; i < 40; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 25));
    });
    const submit = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("提交回答"),
    );
    if (submit) return submit;
  }
  throw new Error("提问卡片没出现（question 事件没渲染成可作答的卡片）");
}

/** 点一个按钮（按文本匹配） */
async function clickButton(text: string) {
  const button = Array.from(container.querySelectorAll("button")).find((b) =>
    b.textContent?.includes(text),
  );
  expect(button, `找不到按钮「${text}」`).toBeTruthy();
  await act(async () => {
    button!.click();
  });
}

/** React 受控 input 不接受直接赋 value：走原生 setter + input 事件 */
function typeIntoInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  useLayout.setState({ details: 0 });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("向用户提问 → 作答", () => {
  it("点选项作答后必须真的再发一次请求（否则对话停住、用户看到『没反应』）", async () => {
    mockApi();
    await mountPanel();
    await sendMessage("帮我新建笔记");

    const submit = await waitForQuestionCard();
    expect(container.textContent ?? "", "提问卡应显示问题文本").toContain(QUESTION.question);

    const before = chatCalls().length; // 首次提问那次
    await clickButton("包含旧文档"); // 选中选项
    await act(async () => {
      submit.click();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 120));
    });

    const after = chatCalls();
    expect(
      after.length,
      "点『提交回答』没有发出请求 —— 回归了：作答回调冻在首帧闭包，handleSend 因 activeSessionId 为 null 静默返回",
    ).toBe(before + 1);

    const answerCall = after[after.length - 1];
    expect(answerCall.url).toContain("/api/ai/chat");
    expect(answerCall.body, "作答应带【回答】前缀回传给模型").toContain("【回答】");
    expect(answerCall.body).toContain(QUESTION.question);
    expect(answerCall.body, "选中的选项应进入作答正文").toContain("包含旧文档");

    // 卡片转为「已回答」（不可重复提交），且模型的新回复到达
    expect(container.textContent ?? "").toContain("包含旧文档");
    expect(container.textContent ?? "").toContain("收到，我这就写。");
  });

  it("自定义输入作答也会被发出（复现用户场景：输入『关于vue』）", async () => {
    mockApi();
    await mountPanel();
    await sendMessage("帮我新建笔记");

    const submit = await waitForQuestionCard();
    const input = container.querySelector<HTMLInputElement>('input[placeholder^="自定义回答"]');
    expect(input, "提问卡应提供自定义输入框").not.toBeNull();

    await act(async () => {
      typeIntoInput(input!, "关于vue");
    });

    const before = chatCalls().length;
    await act(async () => {
      submit.click();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 120));
    });

    const after = chatCalls();
    expect(after.length, "自定义输入作答同样必须发出请求").toBe(before + 1);
    expect(after[after.length - 1].body, "自定义输入应进入作答正文").toContain("关于vue");
    expect(container.textContent ?? "", "已回答的内容应回填在卡片上").toContain("关于vue");
  });
});
