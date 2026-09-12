// 接缝：dynamicPlugins —— 模型现场写插件的通道（Service Definition，宿主侧）。
//
// 定位（照搬 DSH packages/extensions 的产品决策）：
//   * **默认关闭**：不是安全机制，而是"减少攻击面"的默认姿态
//   * 临时插件只存在于**进程内存**：不落盘、不自动恢复；想在下次启动也在，就走正常插件开发流程
//   * 沙箱只收窄 **API 面**（引导模型走服务、别碰 Node 内置），**不是安全边界**：
//     暴露的服务（docStore/tools…）能触达真实运行时，与本机 shell 同级信任
//
// 三角色：
//   Definition ← 本文件：定义注册表契约 + 审批状态 + runner 契约
//   Provider   ← lib/dynamic/runner.ts（组合清单里默认 disabled 的一行）
//   Consumer   ← plugin_* 工具（lib/dynamic/tools.ts）与 UI 卡片
import { Context, provideService, readService } from "@/lib/kernel";

/** 动态包的定义（两半可以是同一段代码的不同入口） */
export interface DynamicDefinition {
  /** 进程内唯一 id（`dyn-1`、`dyn-2` …；交给模型的稳定句柄） */
  id: string;
  /** 人类可读标题（卡片显示） */
  title: string;
  /** 用途说明（模型解释自己写了什么） */
  description?: string;
  /** 宿主半边代码（node:vm 沙箱内求值） */
  host?: string;
  /** 浏览器半边代码（客户端沙箱内求值；需人工审批） */
  client?: string;
  createdAt: string;
}

/**
 * 审批/生命周期状态。
 * `host` 半边与官方插件同级信任（与 bash 一致）；`client` 半边在浏览器里执行、影响用户所见，
 * 因此**需要人工审批**才运行（对齐 DSH 的 awaiting-approval / client-pending）。
 */
export type DynamicState =
  | "defined" // 只登记，未运行（默认）
  | "running"
  | "awaiting-approval" // 等待人工批准（客户端半边）
  | "approved"
  | "stopped"
  | "error";

export interface DynamicRecord {
  definition: DynamicDefinition;
  state: DynamicState;
  /** 最后一条错误/状态说明（面向模型与卡片） */
  note?: string;
}

export interface DynamicRunner {
  /** 登记一个不可变定义（只登记，不运行、不落盘） */
  define(input: { title: string; description?: string; host?: string; client?: string }): DynamicRecord;
  /** 运行宿主半边（必要时先 define） */
  run(id: string): Promise<DynamicRecord>;
  /** 停止并等待静默（所有工具/监听器/服务/定时器回收） */
  stop(id: string): Promise<DynamicRecord>;
  /** 撤销定义（未运行的直接删除；运行中的先停） */
  undefine(id: string): Promise<DynamicRecord | undefined>;
  get(id: string): DynamicRecord | undefined;
  list(): DynamicRecord[];
  /** 批准客户端半边运行 */
  approve(id: string): DynamicRecord;
  /** 启动审计/诊断用：当前运行的 id */
  runningIds(): string[];
}

export const DYNAMIC_SERVICE = "dynamicPlugins";

/** 装配 runner */
export function provideDynamic(ctx: Context, runner: DynamicRunner): void {
  for (const method of ["define", "run", "stop", "undefine", "list"] as const) {
    if (typeof (runner as unknown as Record<string, unknown>)[method] !== "function") {
      throw new Error(`dynamicPlugins 实现不完整，缺少方法：${method}`);
    }
  }
  provideService(ctx, DYNAMIC_SERVICE, runner);
}

/** 读 runner；未装配返回 undefined —— **默认关闭**时就是这个状态 */
export function findDynamic(ctx: Context): DynamicRunner | undefined {
  return readService<DynamicRunner>(ctx, DYNAMIC_SERVICE);
}

/** 读 runner；未装配抛错（工具实现用：默认关闭时工具根本不会被注册） */
export function requireDynamic(ctx: Context): DynamicRunner {
  const runner = findDynamic(ctx);
  if (!runner) {
    throw new Error(
      `dynamicPlugins 未装配：该能力默认关闭，请在 data/settings.json 的 plugins 里启用「dynamic-plugins」`,
    );
  }
  return runner;
}
