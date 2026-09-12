// 动态插件宿主半边沙箱（node:vm）。
//
// ⚠️ 定位（务必如实理解）：**这不是安全边界**。它只做两件事：
//   1. 收窄 **API 面**：把模型引导到服务（inject ctx）上，别去碰 require/fetch/定时器；
//   2. 隔离"意外的全局污染"：每次求值用全新 realm，插件之间不共享全局。
// 暴露出去的服务（docStore / tools / …）能触达真实运行时 —— 与本机 shell 同级信任。
//
// 借鉴 DSH 的三条实现细节（packages/extensions/cordis-host-runner）：
//   * 全局面**刻意很小**：只有 console（带 tag 的写透）、harness、编码原语；
//   * 被扣留的 Node API 做成**会抛错的陷阱函数**，错误信息是"教学文本"（告诉他该用哪个服务）；
//   * `process` / `Buffer` 保持 **undefined**，而不是抛错 getter ——
//     否则 `typeof process` 这种常见特性探测会在取值时直接炸掉。
import vm from "node:vm";
import type { Context } from "@/lib/kernel";

/** 沙箱求值选项 */
export interface HostSandboxOptions {
  /** 定义 id（日志 tag 用） */
  id: string;
  /** 同步求值的时间上限（毫秒）——只约束同步部分，async body 不受其限制 */
  timeoutMs?: number;
  /** 日志出口（默认 console.log/warn/error） */
  onLog?: (level: "log" | "warn" | "error", message: string) => void;
  /** 传给插件 apply 的内核上下文（**门面**，不是原始 ctx） */
  context?: Context;
}

/** 沙箱里可用的上下文门面：白名单动词，隐藏框架内部 */
// 只列 **Cordis** 的 ctx 词汇：读它未声明的属性会触发严格检查并抛错
// （"cannot get property … without inject"）——上一轮就是踩了这个坑。
const CTX_VERBS = [
  "effect",
  "on",
  "once",
  "emit",
  "waterfall",
  "parallel",
  "serial",
  "provide",
  "set",
  "inject",
  "plugin",
] as const;

/** 被扣留的 API → 教学文案（错误信息本身就是文档） */
const TRAPS: Record<string, string> = {
  require: "沙箱内不能用 require／import。需要能力请声明 inject: ['<服务名>']，例如 inject: ['tools'] 后用 ctx.get('tools')",
  fetch: "沙箱内不能用 fetch。网络访问请走服务（在 apply 里用 ctx.get('<服务名>')）",
  setTimeout: "沙箱内不能用 setTimeout。请用 ctx.inject(['timer'], …) 或服务的定时能力",
  setInterval: "沙箱内不能用 setInterval。请用 ctx.inject(['timer'], …) 或服务的定时能力",
  setImmediate: "沙箱内不能用 setImmediate",
  clearTimeout: "沙箱内不能用 clearTimeout",
  clearInterval: "沙箱内不能用 clearInterval",
  eval: "沙箱内不允许 eval",
  WebAssembly: "沙箱内不提供 WebAssembly",
};

export interface HostSandboxSuccess {
  ok: true;
  /** 插件形状：`harness.define()` 收集到的内容 */
  plugin: { name?: string; inject?: string[]; apply: (ctx: Context, config?: unknown) => unknown };
}

export interface HostSandboxFailure {
  ok: false;
  /** 面向模型的可读错误（含定位提示） */
  error: string;
}

export type HostSandboxResult = HostSandboxSuccess | HostSandboxFailure;

/**
 * 服务视图：动态通道里对某些服务的写操作要**自动配对注销**（可逆），
 * 否则模型写的插件卸载后会留下孤儿工具。
 */
function scopedServiceView(real: Context, key: string, service: unknown): unknown {
  if (key !== "tools") return service;
  const registry = service as {
    register?: (definition: unknown) => void;
    unregister?: (name: string) => void;
    [k: string]: unknown;
  };
  if (typeof registry?.register !== "function") return service;
  return new Proxy(registry, {
    get(target, prop, receiver) {
      if (prop === "register") {
        return (definition: { name?: string }) => {
          target.register?.(definition);
          const name = definition?.name;
          if (typeof name === "string") {
            // 挂到插件 fiber 的 effect 上：卸载即撤销（Cordis：回调立即执行、返回值是 disposer）
            real.effect(() => () => {
              target.unregister?.(name);
            });
          }
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

/** 生成 ctx 门面：只暴露白名单动词，其余属性访问被拒绝 */
function createContextFacade(real: Context): Record<string, unknown> {
  const facade: Record<string, unknown> = {};
  for (const verb of CTX_VERBS) {
    const value = (real as unknown as Record<string, unknown>)[verb];
    if (typeof value === "function") {
      facade[verb] = (value as (...args: unknown[]) => unknown).bind(real);
    }
  }
  // 只读服务访问：strict=false（Cordis 默认要求声明过 inject；沙箱侧由服务白名单把关）
  facade.get = (key: unknown) =>
    typeof key === "string"
      ? scopedServiceView(
          real,
          key,
          (real as unknown as { get(k: string, strict?: boolean): unknown }).get(key, false),
        )
      : undefined;
  return facade;
}

/**
 * 在全新 realm 中求值宿主半边代码。
 * 代码需自行调用 `harness.define({ inject?, apply })` 交出插件形状。
 */
export async function evaluateHostHalf(
  code: string,
  options: HostSandboxOptions,
): Promise<HostSandboxResult> {
  const tag = `[plugin:${options.id}]`;
  const log = options.onLog ?? ((level, message) => console[level](message));

  let defined: HostSandboxSuccess["plugin"] | null = null;
  const harness = {
    define(input: unknown) {
      if (typeof input !== "object" || input === null || typeof (input as { apply?: unknown }).apply !== "function") {
        throw new Error("harness.define 需要 { name?, inject?, apply(ctx, config) }，其中 apply 必须是函数");
      }
      const candidate = input as { name?: unknown; inject?: unknown; apply: HostSandboxSuccess["plugin"]["apply"] };
      const inject = Array.isArray(candidate.inject)
        ? candidate.inject.filter((item): item is string => typeof item === "string")
        : [];
      defined = {
        name: typeof candidate.name === "string" ? candidate.name : undefined,
        inject,
        apply: candidate.apply,
      };
      return true;
    },
  };

  const makeTrap = (name: string) => () => {
    throw new Error(TRAPS[name]);
  };

  const sandbox: Record<string, unknown> = {
    harness,
    console: {
      log: (...args: unknown[]) => log("log", `${tag} ${format(args)}`),
      warn: (...args: unknown[]) => log("warn", `${tag} ${format(args)}`),
      error: (...args: unknown[]) => log("error", `${tag} ${format(args)}`),
    },
    // 编码原语（新 realm 里没有；宿主闭包提供，不暴露 Buffer 本体）
    btoa: (text: string) => Buffer.from(String(text), "binary").toString("base64"),
    atob: (text: string) => Buffer.from(String(text), "base64").toString("binary"),
    TextEncoder,
    TextDecoder,
    JSON,
    Math,
    Date,
  };

  // 陷阱：函数型被扣留 API
  for (const name of Object.keys(TRAPS)) {
    if (name in sandbox) continue;
    sandbox[name] = makeTrap(name);
  }
  // 数据型全局保持 undefined（不要做成抛错 getter：那会让 typeof 探测直接炸）
  sandbox.process = undefined;
  sandbox.Buffer = undefined;
  sandbox.globalThis = undefined;
  sandbox.global = undefined;

  const context = vm.createContext(sandbox, { name: `dyn-${options.id}` });

  try {
    const script = new vm.Script(`(async () => {\n${code}\n})()`, {
      filename: `dyn-${options.id}.js`,
    });
    // ⚠️ timeout 只约束**同步**部分：async body 里的 await 之后不受其限制
    const pending = script.runInContext(context, { timeout: options.timeoutMs ?? 5000 });
    // 必须 await：async body 内的 throw 会变成 promise rejection，不 await 就等于把报错吞掉
    await pending;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      error: `宿主半边求值失败：${message}（提示：沙箱里没有 TypeScript 类型标注，请给纯 JavaScript；需要能力请用 inject 声明服务）`,
    };
  }

  if (!defined) {
    return {
      ok: false,
      error: "宿主半边没有调用 harness.define({ apply }) —— 请在代码末尾用 harness.define 交出插件形状",
    };
  }

  const plugin = defined as HostSandboxSuccess["plugin"];
  // 把 apply 的 ctx 参数替换为**门面**：即使代码里直接拿到 ctx，也只能用白名单动词
  const safeApply: HostSandboxSuccess["plugin"]["apply"] = (ctx, config) =>
    plugin.apply(createContextFacade(ctx) as unknown as Context, config);

  return { ok: true, plugin: { name: plugin.name, inject: plugin.inject, apply: safeApply } };
}

/** 参数格式化（沙箱 console 用） */
function format(args: unknown[]): string {
  return args
    .map((item) => {
      if (typeof item === "string") return item;
      try {
        return JSON.stringify(item);
      } catch {
        return String(item);
      }
    })
    .join(" ");
}

/** 供测试/文档引用的沙箱 API 面（说明"刻意很小"） */
export const SANDBOX_GLOBALS = [
  "harness",
  "console",
  "btoa",
  "atob",
  "TextEncoder",
  "TextDecoder",
  "JSON",
  "Math",
  "Date",
  ...Object.keys(TRAPS),
  "process",
  "Buffer",
] as const;
