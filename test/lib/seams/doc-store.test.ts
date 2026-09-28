// docStore 契约单测：装配期校验（缺方法就地失败）+ 内核装配/读取 + 与既有类型面的一致性。
import { describe, it, expect, vi } from "vitest";
import { Context, createRootContext, audit } from "@/lib/kernel";
import { mount } from "@/test/mocks/mount";
import {
  DOC_STORE_SERVICE,
  findDocStore,
  findUiDocStore,
  provideDocStore,
  provideUiDocStore,
  requireDocStore,
  requireUiDocStore,
  type DocStore,
  type Document as SeamDocument,
} from "@/lib/seams/doc-store";
import type { Document as ClientDocument } from "@/lib/db";
import type { Document as ServerDocument } from "@/lib/local/db";

/** 造一个"形状完整"的假实现：各方法都是 spy，便于断言转发 */
function fakeStore(overrides: Partial<DocStore> = {}): DocStore {
  const noop = vi.fn(async () => undefined);
  const base = {
    listSidebarAll: vi.fn(async () => []),
    listSidebar: vi.fn(async () => []),
    listTrash: vi.fn(async () => []),
    listSearch: vi.fn(async () => []),
    getById: vi.fn(async () => null),
    getPublishedById: vi.fn(async () => null),
    listOverview: vi.fn(async () => []),
    create: vi.fn(async () => "new-id"),
    update: noop,
    appendMarkdown: noop,
    archive: noop,
    restore: noop,
    move: noop,
    remove: noop,
    removeIcon: noop,
    removeCoverImage: noop,
    listChatSessions: vi.fn(async () => []),
    createChatSession: vi.fn(async () => "session-id"),
    deleteChatSession: noop,
    listChatHistory: vi.fn(async () => []),
    insertChatMessage: noop,
    setChatSessionTitle: noop,
    touchChatSession: noop,
  } as unknown as DocStore;
  return Object.assign(base, overrides);
}

describe("lib/seams/doc-store 与既有数据面的类型一致性", () => {
  it("客户端（lib/db）与服务端（lib/local/db）的 Document 都能赋给接缝契约（编译期防漂移）", async () => {
    const clientDoc = { id: "client" } as ClientDocument;
    const seamFromClient: SeamDocument = clientDoc;
    const serverDoc = { id: "server" } as ServerDocument;
    const seamFromServer: SeamDocument = serverDoc;

    expect([seamFromClient.id, seamFromServer.id]).toEqual(["client", "server"]);
  });
});

describe("lib/seams/doc-store 装配校验", () => {
  it("UI 子集装配：只要求浏览器可实现的方法（宿主独有的写操作不参与校验）", async () => {
    const ctx = createRootContext();
    const uiStore = fakeStore();
    // 故意删掉宿主独有的三个方法：UI 侧装配仍应成功
    delete (uiStore as unknown as Record<string, unknown>).insertChatMessage;
    delete (uiStore as unknown as Record<string, unknown>).setChatSessionTitle;
    delete (uiStore as unknown as Record<string, unknown>).touchChatSession;

    provideUiDocStore(ctx, uiStore);

    expect(requireUiDocStore(ctx)).toBe(uiStore);
    expect(requireDocStore(ctx)).toBe(uiStore); // 同一个 key：宿主侧视图读到的就是它
  });

  it("UI 子集缺失方法同样就地抛错", async () => {
    const ctx = createRootContext();
    const uiStore = fakeStore();
    delete (uiStore as unknown as Record<string, unknown>).listSidebarAll;

    expect(() => provideUiDocStore(ctx, uiStore)).toThrow(/缺少方法：listSidebarAll/);
    expect(findUiDocStore(ctx)).toBeUndefined();
  });

  it("实现完整时装配成功，可按契约读取", async () => {
    const ctx = createRootContext();
    const store = fakeStore();

    provideDocStore(ctx, store);

    expect(requireDocStore(ctx)).toBe(store);
    expect(findDocStore(ctx)).toBe(store);
    expect(audit(ctx).services).toContain(DOC_STORE_SERVICE);
  });

  it("缺少方法时**就地**抛错，并列出全部缺失方法（不等首次请求才炸）", async () => {
    const ctx = createRootContext();
    const incomplete = fakeStore();
    delete (incomplete as unknown as Record<string, unknown>).move;
    delete (incomplete as unknown as Record<string, unknown>).listChatHistory;

    expect(() => provideDocStore(ctx, incomplete)).toThrow(/缺少方法：move、listChatHistory/);
    // 校验失败不应留下半个服务
    expect(findDocStore(ctx)).toBeUndefined();
  });

  it("未装配时 requireDocStore 抛可操作的错误，findDocStore 返回 undefined", async () => {
    const ctx = createRootContext();

    expect(findDocStore(ctx)).toBeUndefined();
    expect(() => requireDocStore(ctx)).toThrow(/docStore 未装配/);
  });

  it("重复装配由内核抛错（一个 key 一个提供方）", async () => {
    const ctx = createRootContext();
    provideDocStore(ctx, fakeStore());

    // Cordis 的文案：service "docStore" has been registered at <…>
    expect(() => provideDocStore(ctx, fakeStore())).toThrow(/has been registered|已由插件/);
  });

  it("服务随提供方插件卸载而消失（依赖方据此回到 PENDING）", async () => {    const ctx = createRootContext();
    const fiber = await mount(ctx, {
      name: "doc-store-provider",
      apply: (c: Context) => provideDocStore(c, fakeStore()),
    });
    expect(requireDocStore(ctx)).toBeDefined();

    await fiber.dispose();

    expect(findDocStore(ctx)).toBeUndefined();
    expect(audit(ctx).pending.some((p) => p.missing.includes(DOC_STORE_SERVICE))).toBe(false);
  });

  it("消费方可用 inject 门控等待 docStore（缺失时保持 PENDING 并被审计发现）", async () => {
    const ctx = createRootContext();
    const got: string[] = [];
    await mount(ctx, {
      name: "consumer",
      inject: [DOC_STORE_SERVICE],
      apply: (c: Context) => {
        got.push(requireDocStore(c).constructor.name);
      },
    });

    expect(got).toEqual([]);
    expect(audit(ctx).pending).toEqual([{ name: "consumer", missing: [DOC_STORE_SERVICE] }]);

    await mount(ctx, { name: "provider", apply: (c: Context) => provideDocStore(c, fakeStore()) });

    expect(got).toHaveLength(1);
    expect(audit(ctx).pending).toEqual([]);
  });
});
