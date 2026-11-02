// 插件管理器的宿主实现（Service Provider）。
//
// 职责：
//   1. 把"组合清单（代码）"与"用户层 patch（data/settings.json）"合并成可管理的视图；
//   2. 写回启停/配置（静态插件改动重启/刷新生效）；
//   3. 把动态插件（AI 运行时写的）委托给 dynamicPlugins runner；
//   4. 给启动期客户端下发 disabled UI 插件 id。
//
// ⚠️ 服务端专用（读写配置文件、持有内核 ctx）。
import type { Context, LoadReport } from "@/lib/kernel";
import { findDynamic, type DynamicRecord, type DynamicRunner } from "@/lib/seams/dynamic";
import type {
  ClientPluginConfig,
  MarketEntry,
  MarketSourceInfo,
  PluginAdminService,
  PluginBundleExport,
  PluginClientHalf,
  PluginInfo,
  PluginSourceCode,
  PluginStatus,
} from "@/lib/seams/plugins";
import type { SettingsSection } from "@/lib/seams/settings";
import type { MarketSettings, PluginsSettings } from "./lotion-config";
import { PLUGIN_CATALOG, type PluginCatalogEntry } from "./plugin-catalog";
import {
  compareVersions,
  validatePluginManifest,
  type InstalledPluginManifest,
  type PluginPackageStore,
} from "./plugin-package";
import type { InstalledPluginRuntime } from "./plugin-runtime";
import type { StaticPluginController } from "./static-plugin-controller";
import type { PluginMarket } from "./plugin-market";

/** 管理操作的可分类错误（路由层据此映射 HTTP 状态码） */
export class PluginAdminError extends Error {
  constructor(
    public readonly code: "NOT_FOUND" | "CORE_PLUGIN" | "UNSUPPORTED" | "CONFLICT",
    message: string,
  ) {
    super(message);
    this.name = "PluginAdminError";
  }
}

export interface CreatePluginManagerOptions {
  /** 内核上下文（动态插件等运行时能力从这里取） */
  ctx: Context;
  /** `plugins` 配置命名空间的读写句柄（用户层 patch） */
  settings: SettingsSection<PluginsSettings>;
  /** `market` 配置（远端 registry / 验签策略；owner 可改） */
  marketSettings?: SettingsSection<MarketSettings>;
  /** 静态插件的装配报告（可选：测试/早期装配阶段没有） */
  getLoadReport?: () => LoadReport | undefined;
  /** 动态 runner 访问器（默认从 ctx 取；测试可注入） */
  getDynamic?: () => DynamicRunner | undefined;
  /** 已安装插件包存储访问器（默认从 ctx 取） */
  getPackages?: () => PluginPackageStore | undefined;
  /** 已安装插件运行时访问器（默认从 ctx 取） */
  getRuntime?: () => InstalledPluginRuntime | undefined;
  /** 静态插件热挂载控制器（默认从 ctx 取；测试可注入） */
  getStaticController?: () => StaticPluginController | undefined;
  /** 本地市场（测试可注入临时目录） */
  market?: PluginMarket;
  /** 内置插件目录（测试可缩小） */
  catalog?: readonly PluginCatalogEntry[];
}

export function createPluginManager(options: CreatePluginManagerOptions): PluginAdminService {
  const catalog = options.catalog ?? PLUGIN_CATALOG;
  const dynamic = options.getDynamic ?? (() => findDynamic(options.ctx));
  const packages = () => options.getPackages?.();
  const installedRuntime = () => options.getRuntime?.();
  const staticController = () => options.getStaticController?.();
  const pluginMarket = () => options.market;
  const requireMarket = () => {
    if (!options.market) throw new PluginAdminError("UNSUPPORTED", "插件市场未装配");
    return options.market;
  };

  const requirePackages = (): PluginPackageStore => {
    const store = packages();
    if (!store) {
      throw new PluginAdminError("UNSUPPORTED", "已安装插件存储未装配");
    }
    return store;
  };

  const patchOf = (id: string): { disabled?: boolean; config?: unknown } =>
    options.settings.get()[id] ?? {};

  const isEnabled = (entry: PluginCatalogEntry): boolean => {
    if (entry.core) return true;
    const disabled = patchOf(entry.id).disabled;
    if (typeof disabled === "boolean") return !disabled;
    return entry.defaultEnabled !== false;
  };

  const configOf = (id: string): Record<string, unknown> => {
    const config = patchOf(id).config;
    return typeof config === "object" && config !== null && !Array.isArray(config)
      ? (config as Record<string, unknown>)
      : {};
  };

  const statusOf = (entry: PluginCatalogEntry, enabled: boolean): { status: PluginStatus; error?: string } => {
    if (!enabled) return { status: "disabled" };
    // UI 插件不在宿主装配报告里：启用即视为 active（刷新后生效）
    if (entry.scope === "ui") return { status: "active" };

    // 有热挂载控制器时以它为准（启停/配置重挂后的实时状态）
    const controller = staticController();
    if (controller) {
      const error = controller.error(entry.id);
      if (error) return { status: "error", error };
      return { status: controller.running(entry.id) ? "active" : "pending" };
    }

    const report = options.getLoadReport?.();
    if (!report) return { status: "active" };
    const failed = report.failed.find((item) => item.id === entry.id);
    if (failed) return { status: "error", error: failed.error };
    if (report.mounted.some((item) => item.id === entry.id)) return { status: "active" };
    if (report.skipped.includes(entry.id)) return { status: "disabled" };
    return { status: "pending" };
  };

  const staticInfo = (entry: PluginCatalogEntry): PluginInfo => {
    const enabled = isEnabled(entry);
    const { status, error } = statusOf(entry, enabled);
    return {
      id: entry.id,
      title: entry.title,
      description: entry.description,
      scope: entry.scope,
      source: "builtin",
      version: entry.version,
      enabled,
      approved: true,
      core: entry.core,
      // UI 插件要刷新页面；宿主插件有热挂载控制器时无需重启
      restartRequired: entry.scope === "ui" || !staticController(),
      status,
      ...(error ? { error } : {}),
      config: configOf(entry.id),
      configFields: entry.configFields ?? [],
      capabilities: entry.capabilities,
    };
  };

  const installedInfo = (manifest: InstalledPluginManifest, marketEntry?: MarketEntry): PluginInfo => {
    const hasHost = typeof manifest.host === "string" && manifest.host.length > 0;
    const hasClient = typeof manifest.client === "string" && manifest.client.length > 0;
    const runtime = installedRuntime();
    const running = runtime?.runningIds().includes(manifest.id) ?? false;
    const runtimeError = runtime?.error(manifest.id);

    let status: PluginStatus;
    if (!manifest.enabled) status = "disabled";
    else if (runtime && hasHost) status = running ? "active" : runtimeError ? "error" : "pending";
    else if (hasClient && !manifest.approved) status = "stopped";
    else status = "active";

    return {
      id: manifest.id,
      title: manifest.name,
      description: manifest.description ?? "已安装的第三方插件",
      scope: hasHost ? "host" : "ui",
      source: "installed",
      version: manifest.version,
      enabled: manifest.enabled,
      approved: !hasClient || manifest.approved,
      core: false,
      restartRequired: false,
      status,
      ...(runtimeError ? { error: runtimeError } : {}),
      config: manifest.configValues,
      configFields: manifest.config,
      capabilities: manifest.capabilities,
      ...(marketEntry
        ? {
            latestVersion: marketEntry.version,
            updateAvailable: compareVersions(marketEntry.version, manifest.version) > 0,
          }
        : {}),
    };
  };

  const installedList = (): InstalledPluginManifest[] => packages()?.list() ?? [];

  const dynamicStatus = (record: DynamicRecord): PluginStatus => {
    switch (record.state) {
      case "running":
        return "active";
      case "error":
        return "error";
      case "defined":
      case "stopped":
      case "approved":
      case "awaiting-approval":
        return "stopped";
      default:
        return "pending";
    }
  };

  const dynamicInfo = (record: DynamicRecord): PluginInfo => {
    const hasHost = typeof record.definition.host === "string" && record.definition.host.length > 0;
    const hasClient = typeof record.definition.client === "string" && record.definition.client.length > 0;
    const status = dynamicStatus(record);
    return {
      id: record.definition.id,
      title: record.definition.title,
      description: record.definition.description ?? "AI 在运行时定义的临时插件",
      scope: hasHost ? "host" : "ui",
      source: "dynamic",
      version: "0.0.0-dynamic",
      enabled: status === "active",
      // 没有客户端半边时无需审批
      approved: !hasClient || record.state === "approved",
      core: false,
      restartRequired: false,
      status,
      ...(status === "error" && record.note ? { error: record.note } : {}),
      config: {},
      configFields: [],
      capabilities: [hasHost ? "tools" : null, hasClient ? "uiSlots" : null].filter(
        (item): item is string => item !== null,
      ),
    };
  };

  const list = async (): Promise<PluginInfo[]> => {
    const statics = catalog.map(staticInfo);
    const marketEntries = options.market ? await options.market.list().catch(() => []) : [];
    const installed = installedList().map((manifest) =>
      installedInfo(manifest, marketEntries.find((entry) => entry.id === manifest.id)),
    );
    const runner = dynamic();
    const dynamics = runner ? runner.list().map(dynamicInfo) : [];
    return [...statics, ...installed, ...dynamics];
  };

  const findInfo = async (id: string): Promise<PluginInfo> => {
    const all = await list();
    const found = all.find((item) => item.id === id);
    if (!found) throw new PluginAdminError("NOT_FOUND", `未知插件「${id}」`);
    return found;
  };

  const requireRunner = (): DynamicRunner => {
    const runner = dynamic();
    if (!runner) {
      throw new PluginAdminError(
        "UNSUPPORTED",
        "动态插件通道未启用：先在设置里启用「AI 动态插件通道」并重启（data/settings.json 的 plugins.dynamic-plugins）",
      );
    }
    return runner;
  };

  const writePatch = async (id: string, patch: { disabled?: boolean; config?: unknown }) => {
    const current = options.settings.get();
    const next = { ...current, [id]: { ...(current[id] ?? {}), ...patch } };
    await options.settings.set(next);
  };

  const setEnabled = async (id: string, enabled: boolean): Promise<PluginInfo> => {
    const entry = catalog.find((item) => item.id === id);
    if (entry) {
      if (entry.core && !enabled) {
        throw new PluginAdminError("CORE_PLUGIN", `「${entry.title}」是核心插件，不能禁用`);
      }
      await writePatch(id, { disabled: !enabled });
      const controller = staticController();
      if (controller && entry.scope === "host") {
        if (enabled) {
          const result = await controller.enable(id, patchOf(id).config);
          if (!result.ok) {
            throw new PluginAdminError("CONFLICT", result.error ?? "插件启用失败");
          }
        } else {
          await controller.disable(id);
        }
      }
      return staticInfo(entry);
    }
    const manifest = packages()?.get(id);
    if (manifest) {
      const runtime = installedRuntime();
      if (manifest.host) {
        if (enabled) {
          if (!runtime) {
            throw new PluginAdminError("UNSUPPORTED", "已安装插件运行时未装配");
          }
          const result = await runtime.mount(id);
          if (!result.ok) {
            throw new PluginAdminError("CONFLICT", result.error ?? "插件挂载失败");
          }
        } else {
          await runtime?.unmount(id);
        }
      }
      const next = { ...manifest, enabled };
      requirePackages().save(next);
      return installedInfo(next);
    }
    const runner = dynamic();
    // 没有动态通道时，非目录 id 只能视为未知（避免把"拼错 id"误报成"通道没开"）
    if (!runner || !runner.get(id)) {
      throw new PluginAdminError("NOT_FOUND", `未知插件「${id}」`);
    }
    if (enabled) await runner.run(id);
    else await runner.stop(id);
    return findInfo(id);
  };

  const setConfig = async (id: string, config: Record<string, unknown>): Promise<PluginInfo> => {
    const entry = catalog.find((item) => item.id === id);
    if (entry) {
      if (entry.core) {
        throw new PluginAdminError("UNSUPPORTED", "核心插件配置请走 settings 配置层");
      }
      await writePatch(id, { config });
      const controller = staticController();
      if (controller && entry.scope === "host" && isEnabled(entry)) {
        await controller.disable(id);
        const result = await controller.enable(id, config);
        if (!result.ok) {
          throw new PluginAdminError("CONFLICT", result.error ?? "插件重新加载失败");
        }
      }
      return staticInfo(entry);
    }
    const manifest = packages()?.get(id);
    if (manifest) {
      const next = { ...manifest, configValues: { ...manifest.configValues, ...config } };
      requirePackages().save(next);
      const runtime = installedRuntime();
      if (manifest.host && manifest.enabled && runtime) {
        await runtime.unmount(id);
        const result = await runtime.mount(id);
        if (!result.ok) {
          throw new PluginAdminError("CONFLICT", result.error ?? "插件重新加载失败");
        }
      }
      return installedInfo(next);
    }
    const runner = dynamic();
    if (runner?.get(id)) {
      throw new PluginAdminError("UNSUPPORTED", "动态插件暂不支持持久化配置");
    }
    throw new PluginAdminError("NOT_FOUND", `未知插件「${id}」`);
  };

  const approve = async (id: string): Promise<PluginInfo> => {
    const manifest = packages()?.get(id);
    if (manifest) {
      const next = { ...manifest, approved: true };
      requirePackages().save(next);
      return installedInfo(next);
    }
    const runner = requireRunner();
    if (!runner.get(id)) throw new PluginAdminError("NOT_FOUND", `未知动态插件「${id}」`);
    runner.approve(id);
    return findInfo(id);
  };

  const run = async (id: string): Promise<PluginInfo> => {
    if (packages()?.get(id)) return setEnabled(id, true);
    const runner = requireRunner();
    if (!runner.get(id)) throw new PluginAdminError("NOT_FOUND", `未知动态插件「${id}」`);
    await runner.run(id);
    return findInfo(id);
  };

  const stop = async (id: string): Promise<PluginInfo> => {
    if (packages()?.get(id)) return setEnabled(id, false);
    const runner = requireRunner();
    if (!runner.get(id)) throw new PluginAdminError("NOT_FOUND", `未知动态插件「${id}」`);
    await runner.stop(id);
    return findInfo(id);
  };

  const remove = async (id: string): Promise<void> => {
    const entry = catalog.find((item) => item.id === id);
    if (entry) {
      throw new PluginAdminError("UNSUPPORTED", `内置插件「${entry.title}」不能卸载（可禁用）`);
    }
    const manifest = packages()?.get(id);
    if (manifest) {
      await installedRuntime()?.unmount(id);
      requirePackages().remove(id);
      return;
    }
    const runner = requireRunner();
    if (!runner.get(id)) throw new PluginAdminError("NOT_FOUND", `未知动态插件「${id}」`);
    await runner.undefine(id);
  };

  const source = async (id: string): Promise<PluginSourceCode> => {
    const manifest = packages()?.get(id);
    if (manifest) {
      return {
        ...(manifest.host ? { host: manifest.host } : {}),
        ...(manifest.client ? { client: manifest.client } : {}),
      };
    }
    const runner = dynamic();
    const record = runner?.get(id);
    if (!record) {
      throw new PluginAdminError("NOT_FOUND", `插件「${id}」没有可预览的源码`);
    }
    return {
      ...(record.definition.host ? { host: record.definition.host } : {}),
      ...(record.definition.client ? { client: record.definition.client } : {}),
    };
  };

  const clientConfig = async (): Promise<ClientPluginConfig> => ({
    disabledUi: catalog
      .filter((entry) => entry.scope === "ui" && !isEnabled(entry))
      .map((entry) => entry.id),
  });

  const market = async (): Promise<MarketEntry[]> => {
    const source = pluginMarket();
    return source ? await source.list() : [];
  };

  const install = async (id: string): Promise<PluginInfo> => {
    const source = requireMarket();
    const entry = (await source.list()).find((item) => item.id === id);
    if (!entry) throw new PluginAdminError("NOT_FOUND", `市场里没有「${id}」`);

    const store = requirePackages();
    const existing = store.get(id);
    if (existing) {
      const comparison = compareVersions(entry.version, existing.version);
      if (comparison <= 0) {
        throw new PluginAdminError(
          "CONFLICT",
          comparison === 0
            ? `「${entry.name}」已是最新版本（v${existing.version}）`
            : `市场版本 v${entry.version} 低于已安装的 v${existing.version}`,
        );
      }
    }

    const bundle = await source.bundle(entry);
    const manifest = validatePluginManifest(bundle.manifest);
    if (manifest.id !== id) {
      throw new PluginAdminError("CONFLICT", `bundle 的 id「${manifest.id}」与市场条目「${id}」不一致`);
    }
    if (manifest.version !== entry.version) {
      throw new PluginAdminError(
        "CONFLICT",
        `bundle 版本「${manifest.version}」与市场条目「${entry.version}」不一致`,
      );
    }

    // 安装 ≠ 启用 ≠ 批准：
    // 新装默认停用；更新保留启用态与配置，但客户端代码变了必须重新审批。
    const next: InstalledPluginManifest = existing
      ? {
          ...manifest,
          enabled: existing.enabled,
          approved: manifest.client ? false : true,
          configValues: existing.configValues,
        }
      : {
          ...manifest,
          enabled: false,
          approved: manifest.client ? false : true,
        };
    store.save(next);
    source.recordDownload(id);

    if (existing?.enabled && next.host) {
      const runtime = installedRuntime();
      if (runtime) {
        await runtime.unmount(id);
        const mounted = await runtime.mount(id);
        if (!mounted.ok) {
          throw new PluginAdminError("CONFLICT", mounted.error ?? "更新后重新挂载失败");
        }
      }
    }

    return installedInfo(next, entry);
  };

  const installBundle = async (bundle: unknown): Promise<PluginInfo> => {
    const manifest = validatePluginManifest(bundle);
    const store = requirePackages();
    const existing = store.get(manifest.id);
    if (existing && compareVersions(manifest.version, existing.version) <= 0) {
      throw new PluginAdminError(
        "CONFLICT",
        compareVersions(manifest.version, existing.version) === 0
          ? `「${manifest.name}」同版本已安装`
          : `上传版本 v${manifest.version} 低于已安装的 v${existing.version}`,
      );
    }
    // 上传更新视为"替换代码"：先卸掉旧宿主半边，再以停用态落盘
    if (existing?.enabled) await installedRuntime()?.unmount(manifest.id);
    const next: InstalledPluginManifest = {
      ...manifest,
      enabled: false,
      approved: manifest.client ? false : true,
      ...(existing ? { configValues: existing.configValues } : {}),
    };
    store.save(next);
    return installedInfo(next);
  };

  const exportPlugin = async (id: string): Promise<PluginBundleExport> => {
    const manifest = requirePackages().get(id);
    if (!manifest) throw new PluginAdminError("NOT_FOUND", `未安装插件「${id}」`);
    return {
      filename: `${manifest.id}-${manifest.version}.json`,
      bundle: manifest,
    };
  };

  const publishPlugin = async (id: string): Promise<MarketEntry> => {
    const manifest = requirePackages().get(id);
    if (!manifest) throw new PluginAdminError("NOT_FOUND", `未安装插件「${id}」`);
    return requireMarket().publish(manifest);
  };

  const ratePlugin = async (id: string, rating: number, comment?: string): Promise<MarketEntry> => {
    const source = requireMarket();
    source.rate(id, rating, comment);
    const entry = (await source.list()).find((item) => item.id === id);
    if (!entry) throw new PluginAdminError("NOT_FOUND", `市场里没有「${id}」`);
    return entry;
  };

  const getMarketSource = async (): Promise<MarketSourceInfo> => {
    if (!options.market) return { url: "", remote: false, requireSignature: false };
    return options.market.source();
  };

  const setMarketSource = async (url: string): Promise<MarketSourceInfo> => {
    const trimmed = url.trim();
    if (trimmed) {
      let parsed: URL;
      try {
        parsed = new URL(trimmed);
      } catch {
        throw new PluginAdminError("CONFLICT", "registry URL 不合法");
      }
      const localhost = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
      if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && localhost)) {
        throw new PluginAdminError("CONFLICT", "远端市场只支持 HTTPS（localhost 可用 HTTP）");
      }
    }
    if (!options.marketSettings) {
      throw new PluginAdminError("UNSUPPORTED", "market 配置命名空间未装配");
    }
    await options.marketSettings.set({ registryUrl: trimmed });
    return requireMarket().source();
  };

  const clientHalves = async (): Promise<PluginClientHalf[]> => {
    const installed: PluginClientHalf[] = installedList()
      .filter((manifest) => manifest.enabled && manifest.approved && typeof manifest.client === "string")
      .map((manifest) => ({
        id: manifest.id,
        title: manifest.name,
        description: manifest.description ?? null,
        client: manifest.client as string,
      }));

    const dynamics: PluginClientHalf[] = (dynamic()?.list() ?? [])
      .filter((record) => record.state === "approved" && typeof record.definition.client === "string")
      .map((record) => ({
        id: record.definition.id,
        title: record.definition.title,
        description: record.definition.description ?? null,
        client: record.definition.client as string,
      }));

    return [...installed, ...dynamics];
  };

  return {
    list,
    setEnabled,
    setConfig,
    approve,
    run,
    stop,
    remove,
    source,
    market,
    install,
    installBundle,
    exportPlugin,
    publishPlugin,
    ratePlugin,
    getMarketSource,
    setMarketSource,
    clientConfig,
    clientHalves,
  };
}
