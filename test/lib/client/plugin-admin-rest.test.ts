// plugins REST provider 单测：路径/方法/请求体映射与错误解析。
import { describe, expect, it } from "vitest";
import { createRestPluginAdmin } from "@/lib/client/plugin-admin-rest";
import type { PluginInfo } from "@/lib/seams/plugins";

interface Call {
  url: string;
  init?: RequestInit;
}

function makeFetch(responses: Response[]) {
  const calls: Call[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), ...(init ? { init } : {}) });
    const next = responses.shift();
    if (!next) throw new Error("没有预置响应");
    return next;
  }) as typeof fetch;
  return { impl, calls };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const sample: PluginInfo = {
  id: "ui-ai-panel",
  title: "AI 助手面板",
  description: "详情栏面板",
  scope: "ui",
  source: "builtin",
  version: "0.1.0",
  enabled: true,
  approved: true,
  core: false,
  restartRequired: true,
  status: "active",
  config: {},
  configFields: [],
  capabilities: ["uiSlots"],
};

describe("createRestPluginAdmin", () => {
  it("list 解包 plugins；clientConfig 走公开端点", async () => {
    const { impl, calls } = makeFetch([
      json({ plugins: [sample] }),
      json({ disabledUi: ["ui-ai-panel"] }),
    ]);
    const admin = createRestPluginAdmin(impl);

    expect(await admin.list()).toEqual([sample]);
    expect(await admin.clientConfig()).toEqual({ disabledUi: ["ui-ai-panel"] });
    expect(calls.map((call) => call.url)).toEqual([
      "/api/plugins",
      "/api/plugins/client-config",
    ]);
  });

  it("启停/配置/审批映射到正确的方法与请求体", async () => {
    const { impl, calls } = makeFetch([
      json({ ...sample, enabled: false }),
      json(sample),
      json(sample),
    ]);
    const admin = createRestPluginAdmin(impl);

    await admin.setEnabled("ui-ai-panel", false);
    await admin.setConfig("ui-ai-panel", { density: "compact" });
    await admin.approve("ui-ai-panel");

    expect(calls[0]).toMatchObject({ url: "/api/plugins/ui-ai-panel", init: { method: "PATCH" } });
    expect(calls[0].init?.body).toBe(JSON.stringify({ enabled: false }));
    expect(calls[1].init?.body).toBe(JSON.stringify({ config: { density: "compact" } }));
    expect(calls[2]).toMatchObject({
      url: "/api/plugins/ui-ai-panel/approve",
      init: { method: "POST" },
    });
  });

  it("204 删除返回 undefined；错误体提取 message + code", async () => {
    const { impl } = makeFetch([
      new Response(null, { status: 204 }),
      json({ error: "仅最早注册的用户可以管理插件", code: "NOT_OWNER" }, 403),
    ]);
    const admin = createRestPluginAdmin(impl);

    await expect(admin.remove("dyn-1")).resolves.toBeUndefined();
    await expect(admin.list()).rejects.toThrow("仅最早注册的用户可以管理插件（NOT_OWNER）");
  });
});
