"use client";

// 设置 → 插件：内置/已安装/AI 动态插件的列表、启停、配置与状态提示。
//
// 数据全部经 plugins 接缝（REST /api/plugins），组件不直接写 fetch。
// 静态插件的改动要重启（宿主）或刷新（UI）才生效，界面必须如实标出来。
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { PluginInfo } from "@/lib/seams/plugins";
import { usePluginAdmin } from "@/src/kernel/react";
import { PluginConfigDialog } from "./plugin-config-dialog";

function statusLabel(plugin: PluginInfo): { text: string; className: string } {
  switch (plugin.status) {
    case "active":
      return { text: "运行中", className: "text-emerald-600 dark:text-emerald-400" };
    case "error":
      return { text: "出错", className: "text-destructive" };
    case "pending":
      return { text: "等待依赖", className: "text-amber-600 dark:text-amber-400" };
    case "disabled":
      return { text: "已停用", className: "text-shell-label-tertiary" };
    default:
      return { text: "已停止", className: "text-shell-label-tertiary" };
  }
}

function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "blue" | "amber" }) {
  return (
    <span
      className={cn(
        "rounded-[4px] px-1.5 py-[1px] text-[10px] font-medium leading-4",
        tone === "blue" && "bg-primary/10 text-primary",
        tone === "amber" && "bg-amber-500/10 text-amber-700 dark:text-amber-300",
        tone === "neutral" && "bg-secondary text-shell-label-secondary",
      )}
    >
      {children}
    </span>
  );
}

function PluginRow({
  plugin,
  busy,
  onToggle,
  onConfigure,
}: {
  plugin: PluginInfo;
  busy: boolean;
  onToggle: (enabled: boolean) => void;
  onConfigure: () => void;
}) {
  const status = statusLabel(plugin);
  const restartText = plugin.restartRequired
    ? plugin.scope === "ui"
      ? "刷新生效"
      : "重启生效"
    : null;

  return (
    <div className="flex items-start gap-3 rounded-[10px] border-[0.5px] border-shell-border px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[13px] font-medium text-foreground">{plugin.title}</span>
          {plugin.core ? <Badge>核心</Badge> : null}
          {plugin.source === "installed" ? <Badge tone="blue">已安装</Badge> : null}
          {plugin.source === "dynamic" ? <Badge tone="blue">AI 生成</Badge> : null}
          {restartText ? <Badge tone="amber">{restartText}</Badge> : null}
          <span className={cn("text-[11px] font-medium", status.className)}>{status.text}</span>
        </div>
        <p className="mt-0.5 text-[12px] leading-[17px] text-shell-label-tertiary">{plugin.description}</p>
        {plugin.error ? (
          <p className="mt-1 text-[11px] leading-4 text-destructive">{plugin.error}</p>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-1.5 pt-0.5">
        {plugin.configFields.length > 0 ? (
          <Button variant="ghost" size="sm" onClick={onConfigure} disabled={busy || plugin.core}>
            配置
          </Button>
        ) : null}
        <Switch
          checked={plugin.enabled}
          onCheckedChange={onToggle}
          disabled={busy || plugin.core}
          aria-label={`${plugin.title} 启用状态`}
        />
      </div>
    </div>
  );
}

function Section({
  title,
  description,
  plugins,
  busyId,
  onToggle,
  onConfigure,
}: {
  title: string;
  description?: string;
  plugins: PluginInfo[];
  busyId: string | null;
  onToggle: (plugin: PluginInfo, enabled: boolean) => void;
  onConfigure: (plugin: PluginInfo) => void;
}) {
  if (plugins.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <div>
        <h3 className="text-[12px] font-semibold uppercase tracking-[0.04em] text-shell-label-secondary">
          {title}
        </h3>
        {description ? <p className="text-[11px] text-shell-label-tertiary">{description}</p> : null}
      </div>
      <div className="flex flex-col gap-1.5">
        {plugins.map((plugin) => (
          <PluginRow
            key={plugin.id}
            plugin={plugin}
            busy={busyId === plugin.id}
            onToggle={(enabled) => onToggle(plugin, enabled)}
            onConfigure={() => onConfigure(plugin)}
          />
        ))}
      </div>
    </section>
  );
}

export function PluginSettings() {
  const admin = usePluginAdmin();
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [configTarget, setConfigTarget] = useState<PluginInfo | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setPlugins(await admin.list());
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载插件列表失败");
    } finally {
      setLoading(false);
    }
  }, [admin]);

  useEffect(() => {
    void load();
  }, [load]);

  const replace = (next: PluginInfo) => {
    setPlugins((prev) => prev.map((item) => (item.id === next.id ? next : item)));
  };

  const toggle = async (plugin: PluginInfo, enabled: boolean) => {
    setBusyId(plugin.id);
    setError(null);
    setNotice(null);
    try {
      const next = await admin.setEnabled(plugin.id, enabled);
      replace(next);
      if (next.restartRequired) {
        setNotice(
          next.scope === "ui"
            ? `「${next.title}」已${enabled ? "启用" : "停用"}，刷新页面后生效。`
            : `「${next.title}」已${enabled ? "启用" : "停用"}，重启服务后生效。`,
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败");
    } finally {
      setBusyId(null);
    }
  };

  const grouped = useMemo(
    () => ({
      core: plugins.filter((plugin) => plugin.core),
      builtin: plugins.filter((plugin) => !plugin.core && plugin.source === "builtin"),
      installed: plugins.filter((plugin) => plugin.source === "installed"),
      dynamic: plugins.filter((plugin) => plugin.source === "dynamic"),
    }),
    [plugins],
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-shell-label-primary">插件</h2>
          <p className="mt-0.5 text-[12px] leading-[17px] text-shell-label-tertiary">
            内置能力也按插件装配；静态插件的改动需要重启或刷新。
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading}>
          刷新列表
        </Button>
      </div>

      {notice ? (
        <p className="rounded-[6px] bg-primary/10 px-2.5 py-1.5 text-[12px] text-primary">{notice}</p>
      ) : null}
      {error ? (
        <p className="rounded-[6px] bg-destructive/10 px-2.5 py-1.5 text-[12px] text-destructive">
          {error}
        </p>
      ) : null}

      <div className="-mr-2 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-2">
        {loading && plugins.length === 0 ? (
          <div className="flex flex-col gap-2" aria-label="加载中">
            {[0, 1, 2, 3].map((index) => (
              <Skeleton key={index} className="h-[58px] w-full rounded-[10px]" />
            ))}
          </div>
        ) : (
          <>
            <Section title="核心" description="禁用会导致应用不可用，因此固定开启。" plugins={grouped.core} busyId={busyId} onToggle={(plugin, enabled) => void toggle(plugin, enabled)} onConfigure={setConfigTarget} />
            <Section title="内置插件" description="路由、动态通道与 UI 面板。" plugins={grouped.builtin} busyId={busyId} onToggle={(plugin, enabled) => void toggle(plugin, enabled)} onConfigure={setConfigTarget} />
            <Section title="已安装" description="从市场安装的第三方插件。" plugins={grouped.installed} busyId={busyId} onToggle={(plugin, enabled) => void toggle(plugin, enabled)} onConfigure={setConfigTarget} />
            <Section title="AI 动态插件" description="模型在运行时定义；客户端半边需要人工批准。" plugins={grouped.dynamic} busyId={busyId} onToggle={(plugin, enabled) => void toggle(plugin, enabled)} onConfigure={setConfigTarget} />
            {plugins.length === 0 && !loading ? (
              <p className="rounded-[10px] border-[0.5px] border-dashed border-shell-border px-3 py-6 text-center text-[12px] text-shell-label-tertiary">
                没有可管理的插件。
              </p>
            ) : null}
          </>
        )}
      </div>

      <PluginConfigDialog
        plugin={configTarget}
        open={configTarget !== null}
        onOpenChange={(open) => {
          if (!open) setConfigTarget(null);
        }}
        onSave={async (config) => {
          if (!configTarget) return;
          const next = await admin.setConfig(configTarget.id, config);
          replace(next);
          setNotice(`「${next.title}」配置已保存，重启服务后生效。`);
        }}
      />
    </div>
  );
}
