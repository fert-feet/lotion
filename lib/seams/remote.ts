// 接缝：remote —— 客户端调用宿主能力的**白名单边界**（Service Definition，客户端侧）。
//
// 这是 DSH 全仓**唯一强制的枚举式白名单**（packages/api/remotes/src/client/index.ts:108）：
// 插件（尤其是动态插件）能从浏览器调到哪些宿主能力，是一张写死的表；
// **没有运行期动态注册路径** —— 想加一个 namespace，必须改这里的枚举并重新装配。
//
// 为什么这条最值得抄：内核的 `inject` 是"声明式约定"，可被 ctx.get 绕过（DSH 自己也这么用）；
// 而这里的白名单是**代码级枚举**，绕过它需要改代码，而不是写错一行声明。
//
// 两端共享：客户端侧的实现走 REST（lib/dynamic/client-remote.ts），宿主侧的实现就是那些路由。
import { Context, provideService, readService } from "@/lib/kernel";

/**
 * 允许的 namespace 枚举（改这里 = 改契约，需同时加宿主路由）。
 * 与 DSH 一样刻意保持很短：只放**动态/插件代码真正需要**的只读入口。
 */
export const REMOTE_NAMESPACES = ["documents", "chat", "dynamic"] as const;
export type RemoteNamespace = (typeof REMOTE_NAMESPACES)[number];

/** 每个 namespace 允许的方法（再收一层：即使 namespace 对，方法也要在白名单里） */
export const REMOTE_METHODS: Record<RemoteNamespace, readonly string[]> = {
  documents: ["list", "get"],
  chat: ["sessions"],
  dynamic: ["plugins"],
};

/** 调用请求（白名单校验的输入形状） */
export interface RemoteCall {
  namespace: string;
  method: string;
  args?: unknown;
}

export interface RemoteService {
  /**
   * 调用宿主能力。
   * @throws namespace/method 不在白名单时抛错（错误信息列出允许项，便于自查）
   */
  call<T = unknown>(call: RemoteCall): Promise<T>;
}

export const REMOTE_SERVICE = "remote";

/** 白名单校验：返回 null 表示允许，否则返回拒绝理由 */
export function checkRemoteCall(call: RemoteCall): string | null {
  const namespace = call?.namespace;
  if (typeof namespace !== "string" || !(REMOTE_NAMESPACES as readonly string[]).includes(namespace)) {
    return `namespace「${String(namespace)}」不在白名单内（允许：${REMOTE_NAMESPACES.join("、")}）`;
  }
  const methods = REMOTE_METHODS[namespace as RemoteNamespace];
  if (typeof call.method !== "string" || !methods.includes(call.method)) {
    return `方法「${String(call.method)}」不在 namespace「${namespace}」的白名单内（允许：${methods.join("、")}）`;
  }
  return null;
}

/** 包装一个实现：所有调用先过白名单（宿主/客户端两侧都适用） */
export function guardRemote(inner: RemoteService): RemoteService {
  return {
    async call<T>(call: RemoteCall): Promise<T> {
      const rejection = checkRemoteCall(call);
      if (rejection) throw new Error(`[remote] 调用被拒绝：${rejection}`);
      return inner.call<T>(call);
    },
  };
}

/** 装配 */
export function provideRemote(ctx: Context, remote: RemoteService): void {
  if (typeof remote?.call !== "function") {
    throw new Error("remote 实现不完整：需要 call()");
  }
  provideService(ctx, REMOTE_SERVICE, guardRemote(remote));
}

/** 读 remote；未装配返回 undefined */
export function findRemote(ctx: Context): RemoteService | undefined {
  return readService<RemoteService>(ctx, REMOTE_SERVICE);
}

/** 读 remote；未装配抛错 */
export function requireRemote(ctx: Context): RemoteService {
  const remote = findRemote(ctx);
  if (!remote) {
    throw new Error(
      `remote 未装配：客户端内核装配时挂载 remote 提供方（服务 key「${REMOTE_SERVICE}」）`,
    );
  }
  return remote;
}
