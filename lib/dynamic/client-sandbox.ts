// 动态插件客户端半边沙箱（浏览器侧求值）。
//
// ⚠️ 与宿主半边一样：**这不是安全边界**。这里的做法是 DSH 的
// packages/extensions/cordis-client-runner/src/client/evaluator.ts:171 那套：
// 用 `new Function(...参数名, code)` 把危险全局名**做成形参**（传 undefined 或陷阱函数），
// 让裸标识符 `fetch(...)` / `process` 拿不到真东西。
//
// ⚠️ 必须如实知道的局限（DSH 自己的注释也点明了）：
// **形参遮蔽只挡裸标识符**。`globalThis.fetch`、`window.setInterval`、`eval`、动态 import
// 依然可达 —— 客户端半边因此属于"需人工审批后才运行"的信任级别（见 DynamicState.awaiting-approval）。
import type { Context } from "@/lib/kernel";
import { findRemote } from "@/lib/seams/remote";
import { findUiSlots, UI_SLOTS_SERVICE } from "@/lib/seams/ui-slots";

/** 被遮蔽的全局名 → 文案（传 undefined 的用 null 表示"保持 undefined"） */
const SHADOWED: Record<string, string | null> = {
  process: null,
  Buffer: null,
  require: "客户端半边没有 require。需要数据请用 ctx.get('remote').call({ namespace, method })",
  fetch: "客户端半边不能直接 fetch。请走 ctx.get('remote').call({ namespace: 'documents', method: 'list' })",
  XMLHttpRequest: "客户端半边不提供 XMLHttpRequest，请走 remote 服务",
  setTimeout: "客户端半边不提供 setTimeout（定时请用宿主半边或插件自身的 effect）",
  setInterval: "客户端半边不提供 setInterval",
};

export interface ClientSandboxOptions {
  /** 定义 id（日志 tag） */
  id: string;
  /** 日志出口（默认宿主 console，带 tag） */
  onLog?: (level: "log" | "warn" | "error", message: string) => void;
}

export interface ClientSandboxSuccess {
  ok: true;
  /** 插件形状：`harness.define()` 收集到的内容 */
  plugin: {
    name?: string;
    inject?: string[];
    apply: (ctx: Context) => unknown;
  };
}

export interface ClientSandboxFailure {
  ok: false;
  error: string;
}

export type ClientSandboxResult = ClientSandboxSuccess | ClientSandboxFailure;

/**
 * 给客户端半边用的 ctx 门面：只允许
 *   - `uiSlots`（贡献 UI）
 *   - `remote`（白名单调用，且只能走 remote.call）
 * 其余服务一律取不到（`get` 对非白名单服务返回 undefined）。
 */
const CLIENT_ALLOWED_SERVICES = [UI_SLOTS_SERVICE, "remote"] as const;

function createClientFacade(real: Context): Record<string, unknown> {
  return {
    get: (key: unknown) => {
      if (typeof key !== "string") return undefined;
      if (!(CLIENT_ALLOWED_SERVICES as readonly string[]).includes(key)) return undefined;
      // strict=false：白名单已把关
      return (real as unknown as { get(k: string, strict?: boolean): unknown }).get(key, false);
    },
    /** 事件：允许监听（可逆，随插件卸载移除） */
    on: (name: unknown, listener: unknown) => {
      if (typeof name !== "string" || typeof listener !== "function") {
        throw new Error("ctx.on 需要 (事件名, 监听函数)");
      }
      return (real.on as unknown as (n: string, l: (...a: unknown[]) => void) => () => void)(
        name,
        listener as (...a: unknown[]) => void,
      );
    },
    // 透传 Cordis 的 effect 语义：回调立即执行、返回值是 disposer
    effect: (fn: unknown) => {
      if (typeof fn !== "function") throw new Error("ctx.effect 需要函数（且应返回 disposer）");
      real.effect(fn as never);
    },
  };
}

/**
 * 在浏览器里求值客户端半边代码。
 * 代码需调用 `harness.define({ name?, apply })`（客户端半边不需要 inject：可用服务只有两个）。
 */
export function evaluateClientHalf(code: string, options: ClientSandboxOptions): ClientSandboxResult {
  const tag = `[plugin:${options.id}]`;
  const log = options.onLog ?? ((level: "log" | "warn" | "error", message: string) => console[level](message));

  let defined: ClientSandboxSuccess["plugin"] | null = null;
  const harness = {
    define(input: unknown) {
      if (typeof input !== "object" || input === null || typeof (input as { apply?: unknown }).apply !== "function") {
        throw new Error("harness.define 需要 { name?, apply(ctx) }，其中 apply 必须是函数");
      }
      const candidate = input as { name?: unknown; apply: ClientSandboxSuccess["plugin"]["apply"] };
      defined = {
        name: typeof candidate.name === "string" ? candidate.name : undefined,
        apply: candidate.apply,
      };
      return true;
    },
  };

  const consoleFacade = {
    log: (...args: unknown[]) => log("log", `${tag} ${format(args)}`),
    warn: (...args: unknown[]) => log("warn", `${tag} ${format(args)}`),
    error: (...args: unknown[]) => log("error", `${tag} ${format(args)}`),
  };

  // 形参遮蔽：SHADOWED 的名字 + harness/console 一起做成形参
  const parameterNames = ["harness", "console", ...Object.keys(SHADOWED)];
  const parameterValues: unknown[] = [harness, consoleFacade];
  for (const [name, hint] of Object.entries(SHADOWED)) {
    parameterValues.push(
      hint === null
        ? undefined
        : () => {
            throw new Error(hint);
          },
    );
    void name;
  }

  let factory: (...args: unknown[]) => unknown;
  try {
    factory = new Function(...parameterNames, `return (async () => {\n${code}\n})();`) as typeof factory;
  } catch (error) {
    return {
      ok: false,
      error: `客户端半边语法错误：${error instanceof Error ? error.message : String(error)}（沙箱里没有 TypeScript 类型标注，请给纯 JavaScript）`,
    };
  }

  // 求值是 async IIFE：同步部分立即回归（注册代码通常在同步段），异步失败只记日志
  const pending = factory(...parameterValues) as unknown;
  if (pending && typeof (pending as Promise<unknown>).catch === "function") {
    void (pending as Promise<unknown>).catch((error: unknown) => {
      log("error", `${tag} 客户端半边求值失败：${error instanceof Error ? error.message : String(error)}`);
    });
  }

  if (!defined) {
    return {
      ok: false,
      error: "客户端半边没有调用 harness.define({ apply }) —— 请在代码末尾用 harness.define 交出插件形状",
    };
  }

  const plugin = defined as ClientSandboxSuccess["plugin"];
  return {
    ok: true,
    plugin: {
      name: plugin.name,
      apply: (ctx: Context) => plugin.apply(createClientFacade(ctx) as unknown as Context),
    },
  };
}

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

/** 供测试/文档引用：被遮蔽的全局名 */
export const CLIENT_SHADOWED_GLOBALS = Object.keys(SHADOWED);

/** 客户端半边可用服务（刻意只有两个：贡献 UI + 白名单调用） */
export const CLIENT_ALLOWED = CLIENT_ALLOWED_SERVICES;

/** 便捷：客户端半边拿 remote（未装配时 undefined） */
export function clientRemote(ctx: Context) {
  return findRemote(ctx);
}

/** 便捷：客户端半边拿 uiSlots（未装配时 undefined） */
export function clientSlots(ctx: Context) {
  return findUiSlots<unknown>(ctx);
}
