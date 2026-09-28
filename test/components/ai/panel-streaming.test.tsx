// @vitest-environment jsdom
// AI 面板**流式渲染**集成测试（真实挂载 app 路由 + 真实 SSE 解析）。
//
// 事故背景：服务端 2 秒就把答案落库了，用户界面却一直停在"正在思考 · 56s"，
// 刷新后才看到回答。根因是客户端提交渲染这条链：
//   1) 文本提交只挂了 requestAnimationFrame —— 后台标签页 rAF 被暂停，textRaf 永远非 null，
//      之后所有提交都被节流吞掉；
//   2) 提交又被"组件已卸载"门控挡着，一旦误判，整轮流式文本再也不渲染；
//   3) 收尾用 owned() 门控，请求被接管时那一轮永远留在 running。
// 这条测试把"事件进得来 → 文本上屏 → 回合收尾"整条链钉住。
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

const REPLY = "你好！我是你的笔记助手，当前打开的是一篇空白文档。";

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

/** 分派 API：登录 / 会话 / 历史 / AI 流式 */
function mockApi(options: { streamDelayMs?: number } = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      if (url.includes("/api/me")) return json({ user: { id: "u1", email: "u@x.com", name: null } });
      if (url.includes("/api/ai/chat")) {
        const events = [
          { type: "turn_start", turn: 1, startedAt: new Date().toISOString() },
          { type: "text", text: REPLY },
          { type: "turn_end", turn: 1, durationMs: 12, tokens: { input: 3, output: 9 } },
        ];
        if (!options.streamDelayMs) return sseResponse(events);
        // 模拟"回答分块到达"，用来验证中途提交
        return new Response(
          new ReadableStream<Uint8Array>({
            async start(controller) {
              for (const event of events) {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
                await new Promise((r) => setTimeout(r, options.streamDelayMs));
              }
              controller.close();
            },
          }),
          { status: 200, headers: { "content-type": "text/event-stream" } },
        );
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

describe("AI 面板流式渲染", () => {
  it("SSE 文本到达后渲染到界面上，并且回合收尾（不再永远『正在思考』）", async () => {
    mockApi();
    await mountPanel();
    await sendMessage("hi");

    await act(async () => {
      await new Promise((r) => setTimeout(r, 120));
    });

    const text = container.textContent ?? "";
    expect(text).toContain("hi"); // 用户气泡
    expect(text, "流式回答没有渲染到界面（服务端答完但界面一直转圈）").toContain(REPLY);
    expect(text).not.toContain("正在思考"); // turn_end 之后应已收尾
  });

  it("后台标签页（rAF 被暂停）也能渲染：定时器兜底不能缺席", async () => {
    // 模拟隐藏标签页：requestAnimationFrame 永不回调
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    mockApi({ streamDelayMs: 10 });
    await mountPanel();
    await sendMessage("hi");

    await act(async () => {
      await new Promise((r) => setTimeout(r, 250));
    });

    expect(
      container.textContent ?? "",
      "rAF 不回调时文本丢失：文本提交必须同时挂定时器兜底",
    ).toContain(REPLY);
  });

  it("分块到达的流式回答会逐块提交（不是等流结束才一次性出现）", async () => {
    mockApi({ streamDelayMs: 30 });
    await mountPanel();
    await sendMessage("hi");

    // 只等第一个 text 事件（30ms 间隔，给第一次提交留出时间）
    await act(async () => {
      await new Promise((r) => setTimeout(r, 60));
    });
    expect(container.textContent ?? "").toContain(REPLY);
  });
});
