"use client";

// 设置 → 市场：本地 registry 的插件发现与安装。
//
// 安装 = 落盘 + 默认停用；启用与客户端半边审批在「插件」页完成。
// 第三方代码与本机 shell 同信任级别，界面必须明说。
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { MarketEntry } from "@/lib/seams/plugins";
import { usePluginAdmin } from "@/src/kernel/react";

export function PluginMarket() {
  const admin = usePluginAdmin();
  const [entries, setEntries] = useState<MarketEntry[]>([]);
  const [installed, setInstalled] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [catalog, plugins] = await Promise.all([admin.market(), admin.list()]);
      setEntries(catalog);
      setInstalled(new Set(plugins.filter((item) => item.source === "installed").map((item) => item.id)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载市场失败");
    } finally {
      setLoading(false);
    }
  }, [admin]);

  useEffect(() => {
    void load();
  }, [load]);

  const install = async (entry: MarketEntry) => {
    setBusy(entry.id);
    setError(null);
    setNotice(null);
    try {
      await admin.install(entry.id);
      setInstalled((prev) => new Set(prev).add(entry.id));
      setNotice(`「${entry.name}」已安装。去「插件」页启用它。`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "安装失败");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-shell-label-primary">插件市场</h2>
          <p className="mt-0.5 text-[12px] leading-[17px] text-shell-label-tertiary">
            本地目录精选。安装后默认停用；客户端半边还需人工批准。
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading}>
          刷新
        </Button>
      </div>

      <p className="rounded-[6px] bg-amber-500/10 px-2.5 py-1.5 text-[11px] leading-4 text-amber-800 dark:text-amber-200">
        ⚠️ 第三方插件代码与本机同信任级别（不是安全沙箱）。安装前请审阅源码。
      </p>

      {notice ? (
        <p className="rounded-[6px] bg-primary/10 px-2.5 py-1.5 text-[12px] text-primary">{notice}</p>
      ) : null}
      {error ? (
        <p className="rounded-[6px] bg-destructive/10 px-2.5 py-1.5 text-[12px] text-destructive">{error}</p>
      ) : null}

      <div className="-mr-2 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-2">
        {loading ? (
          [0, 1, 2].map((index) => <Skeleton key={index} className="h-[86px] w-full rounded-[10px]" />)
        ) : entries.length === 0 ? (
          <p className="rounded-[10px] border-[0.5px] border-dashed border-shell-border px-3 py-6 text-center text-[12px] text-shell-label-tertiary">
            市场里还没有插件。
          </p>
        ) : (
          entries.map((entry) => {
            const isInstalled = installed.has(entry.id);
            return (
              <div
                key={entry.id}
                className="flex items-start gap-3 rounded-[10px] border-[0.5px] border-shell-border px-3 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[13px] font-medium text-foreground">{entry.name}</span>
                    <span className="rounded-[4px] bg-secondary px-1.5 py-[1px] text-[10px] leading-4 text-shell-label-secondary">
                      v{entry.version}
                    </span>
                    {entry.author ? (
                      <span className="text-[11px] text-shell-label-tertiary">{entry.author}</span>
                    ) : null}
                  </div>
                  <p className="mt-0.5 text-[12px] leading-[17px] text-shell-label-tertiary">
                    {entry.description}
                  </p>
                </div>
                <Button
                  variant={isInstalled ? "secondary" : "default"}
                  size="sm"
                  disabled={isInstalled || busy === entry.id}
                  onClick={() => void install(entry)}
                >
                  {isInstalled ? "已安装" : busy === entry.id ? "安装中…" : "安装"}
                </Button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
