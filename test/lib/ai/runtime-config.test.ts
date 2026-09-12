// AI 运行期配置：优先级（显式 > env > 默认）与 provider 构造（apiKey 必须显式传给工厂）。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DEFAULT_AI_MODEL, createAiModel, resolveAiRuntimeConfig } from "@/lib/ai/runtime-config";

const { createDeepSeekMock, deepSeekMock } = vi.hoisted(() => ({
  createDeepSeekMock: vi.fn((options: { apiKey?: string }) => (modelId: string) => ({
    kind: "custom",
    modelId,
    options,
  })),
  deepSeekMock: vi.fn((modelId: string) => ({ kind: "default", modelId })),
}));

vi.mock("@ai-sdk/deepseek", () => ({
  createDeepSeek: createDeepSeekMock,
  deepSeek: deepSeekMock,
}));

const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved.AI_MODEL = process.env.AI_MODEL;
  saved.KEY = process.env.DEEPSEEK_API_KEY;
  delete process.env.AI_MODEL;
  delete process.env.DEEPSEEK_API_KEY;
  createDeepSeekMock.mockClear();
  deepSeekMock.mockClear();
});

afterEach(() => {
  if (saved.AI_MODEL === undefined) delete process.env.AI_MODEL;
  else process.env.AI_MODEL = saved.AI_MODEL;
  if (saved.KEY === undefined) delete process.env.DEEPSEEK_API_KEY;
  else process.env.DEEPSEEK_API_KEY = saved.KEY;
});

describe("lib/ai/runtime-config resolveAiRuntimeConfig", () => {
  it("显式配置优先于环境变量", () => {
    process.env.AI_MODEL = "env-model";
    process.env.DEEPSEEK_API_KEY = "sk-env";

    expect(resolveAiRuntimeConfig({ model: "cfg-model" })).toEqual({
      model: "cfg-model",
      apiKey: "sk-env",
    });
  });

  it("空串/纯空白不被当成有效值（回退环境变量，再回退默认）", () => {
    expect(resolveAiRuntimeConfig({ model: "  ", apiKey: "  " })).toEqual({
      model: DEFAULT_AI_MODEL,
      apiKey: "",
    });

    process.env.AI_MODEL = "env-model";
    expect(resolveAiRuntimeConfig({ model: "" }).model).toBe("env-model");
  });

  it("每次调用都重新解析（改环境变量无需重启进程）", () => {
    expect(resolveAiRuntimeConfig().model).toBe(DEFAULT_AI_MODEL);
    process.env.AI_MODEL = "hot-changed";
    expect(resolveAiRuntimeConfig().model).toBe("hot-changed");
  });
});

describe("lib/ai/runtime-config createAiModel", () => {
  it("有 apiKey 时用 createDeepSeek 显式构造（否则 data/settings.json 里的 key 等于摆设）", () => {
    const model = createAiModel({ model: "cfg-model", apiKey: "sk-configured" }) as unknown as {
      kind: string;
      modelId: string;
      options: { apiKey: string };
    };

    expect(createDeepSeekMock).toHaveBeenCalledWith({ apiKey: "sk-configured" });
    expect(deepSeekMock).not.toHaveBeenCalled();
    expect(model).toMatchObject({ kind: "custom", modelId: "cfg-model" });
  });

  it("无 apiKey 时走默认 provider（由 SDK 报出可读的缺失错误）", () => {
    const model = createAiModel({ model: "cfg-model", apiKey: "" }) as unknown as { kind: string };

    expect(deepSeekMock).toHaveBeenCalledWith("cfg-model");
    expect(createDeepSeekMock).not.toHaveBeenCalled();
    expect(model.kind).toBe("default");
  });
});
