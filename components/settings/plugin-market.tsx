"use client";

// 设置 → 市场：搜索/分类/排序、安装/更新、启用/批准、上传、评分评论、远端 registry 配置。
//
// 安装 = 落盘 + 默认停用；市场卡片可直接启用并批准客户端半边，也可去「插件」页。
// 第三方代码与本机 shell 同信任级别，界面必须明说；签名/校验和只做完整性提示。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { MarketEntry, MarketSourceInfo, PluginInfo } from "@/lib/seams/plugins";
import { usePluginAdmin } from "@/src/kernel/react";

type SortKey = "recommended" | "downloads" | "rating" | "recent" | "name";

const CAPABILITY_LABEL: Record<string, string> = {
  tools: "AI 工具",
  httpRoutes: "HTTP 路由",
  ui: "界面插件",
};

const SORT_OPTIONS: Array<{ value: SortKey; label: string }> = [
  { value: "recommended", label: "推荐" },
  { value: "downloads", label: "下载量" },
  { value: "rating", label: "评分" },
  { value: "recent", label: "最近更新" },
  { value: "name", label: "名称" },
];

function capabilityLabel(capability: string): string {
  return CAPABILITY_LABEL[capability] ?? capability;
}

function Stars({ rating = 0, count = 0 }: { rating?: number; count?: number }) {
  const rounded = Math.round(rating);
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-shell-label-tertiary">
      <span className="text-amber-500" aria-hidden>
        {"★".repeat(rounded)}
        {"☆".repeat(Math.max(0, 5 - rounded))}
      </span>
      <span>
        {rating > 0 ? rating.toFixed(1) : "—"}
        {count > 0 ? ` (${count})` : ""}
      </span>
    </span>
  );
}

function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "blue" | "amber" | "green" }) {
  return (
    <span
      className={cn(
        "rounded-[4px] px-1.5 py-[1px] text-[10px] font-medium leading-4",
        tone === "blue" && "bg-primary/10 text-primary",
        tone === "amber" && "bg-amber-500/10 text-amber-700 dark:text-amber-300",
        tone === "green" && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
        tone === "neutral" && "bg-secondary text-shell-label-secondary",
      )}
    >
      {children}
    </span>
  );
}

export function PluginMarket() {
  const admin = usePluginAdmin();
  const [entries, setEntries] = useState<MarketEntry[]>([]);
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [source, setSource] = useState<MarketSourceInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("全部");
  const [sort, setSort] = useState<SortKey>("recommended");
  const [confirmEntry, setConfirmEntry] = useState<MarketEntry | null>(null);
  const [ratingEntry, setRatingEntry] = useState<MarketEntry | null>(null);
  const [ratingValue, setRatingValue] = useState(5);
  const [ratingComment, setRatingComment] = useState("");
  const [sourceDraft, setSourceDraft] = useState("");
  const [sourceBusy, setSourceBusy] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [catalog, list, info] = await Promise.all([
        admin.market(),
        admin.list().catch(() => [] as PluginInfo[]),
        admin.getMarketSource().catch(() => null),
      ]);
      setEntries(catalog);
      setPlugins(list);
      setSource(info);
      setSourceDraft(info?.url ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载市场失败");
    } finally {
      setLoading(false);
    }
  }, [admin]);

  useEffect(() => {
    void load();
  }, [load]);

  const installed = useMemo(
    () => new Map(plugins.filter((item) => item.source === "installed").map((item) => [item.id, item])),
    [plugins],
  );

  const categories = useMemo(
    () => ["全部", ...new Set(entries.map((entry) => entry.category).filter((value): value is string => Boolean(value)))],
    [entries],
  );

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    const filtered = entries.filter((entry) => {
      if (category !== "全部" && entry.category !== category) return false;
      if (!query) return true;
      const haystack = [entry.name, entry.description, entry.author, ...(entry.tags ?? [])]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });

    return [...filtered].sort((a, b) => {
      switch (sort) {
        case "downloads":
          return (b.downloads ?? 0) - (a.downloads ?? 0);
        case "rating":
          return (b.rating ?? 0) - (a.rating ?? 0);
        case "recent":
          return (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "");
        case "name":
          return a.name.localeCompare(b.name);
        default:
          return (b.rating ?? 0) * 20 + (b.downloads ?? 0) - ((a.rating ?? 0) * 20 + (a.downloads ?? 0));
      }
    });
  }, [entries, search, category, sort]);

  const install = async (entry: MarketEntry) => {
    setBusyId(entry.id);
    setError(null);
    setNotice(null);
    try {
      await admin.install(entry.id);
      setConfirmEntry(null);
      setNotice(`「${entry.name}」已安装/更新。现在可以直接在市场里启用。`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "安装失败");
    } finally {
      setBusyId(null);
    }
  };

  const enablePlugin = async (entry: MarketEntry) => {
    setBusyId(entry.id);
    setError(null);
    setNotice(null);
    try {
      await admin.setEnabled(entry.id, true);
      setNotice(`「${entry.name}」已启用。${entry.capabilities?.includes("ui") ? "客户端半边还需批准。" : ""}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "启用失败");
    } finally {
      setBusyId(null);
    }
  };

  const approvePlugin = async (entry: MarketEntry) => {
    setBusyId(entry.id);
    setError(null);
    setNotice(null);
    try {
      await admin.approve(entry.id);
      setNotice(`「${entry.name}」客户端半边已批准。点「刷新页面」后生效。`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "批准失败");
    } finally {
      setBusyId(null);
    }
  };

  const upload = async (file: File) => {
    setUploadBusy(true);
    setError(null);
    setNotice(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;
      const info = await admin.installBundle(parsed);
      setNotice(`「${info.title}」已导入（默认停用），去「插件」页启用。`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "导入失败（需要合法 plugin.json）");
    } finally {
      setUploadBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const submitRating = async () => {
    if (!ratingEntry) return;
    setBusyId(ratingEntry.id);
    setError(null);
    try {
      await admin.ratePlugin(ratingEntry.id, ratingValue, ratingComment.trim() || undefined);
      setRatingEntry(null);
      setRatingComment("");
      setNotice("评分已记录。");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "评分失败");
    } finally {
      setBusyId(null);
    }
  };

  const saveSource = async () => {
    setSourceBusy(true);
    setError(null);
    setNotice(null);
    try {
      const info = await admin.setMarketSource(sourceDraft.trim());
      setSource(info);
      setSourceDraft(info.url);
      setNotice(info.remote ? "已切换到远端市场源。" : "已恢复本地市场目录。");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存市场源失败");
    } finally {
      setSourceBusy(false);
    }
  };

  const actionFor = (
    entry: MarketEntry,
  ): { label: string; disabled: boolean; kind: "install" | "update" | "enable" | "approve" | "enabled" } => {
    const current = installed.get(entry.id);
    if (!current) return { label: "安装", disabled: false, kind: "install" };
    if (current.updateAvailable) return { label: `更新 v${entry.version}`, disabled: false, kind: "update" };
    if (!current.enabled) return { label: "启用", disabled: false, kind: "enable" };
    if (!current.approved) return { label: "批准", disabled: false, kind: "approve" };
    return { label: "已启用", disabled: true, kind: "enabled" };
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-shell-label-primary">插件市场</h2>
          <p className="mt-0.5 text-[12px] leading-[17px] text-shell-label-tertiary">
            本地精选 + 可选远端 registry。安装后默认停用；客户端半边还需人工批准。
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void upload(file);
            }}
          />
          <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()} disabled={uploadBusy}>
            {uploadBusy ? "导入中…" : "上传插件"}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading}>
            刷新
          </Button>
        </div>
      </div>

      <p className="rounded-[6px] bg-amber-500/10 px-2.5 py-1.5 text-[11px] leading-4 text-amber-800 dark:text-amber-200">
        ⚠️ 第三方插件代码与本机同信任级别（不是安全沙箱）。安装前请审阅权限与源码。
      </p>

      {notice ? (
        <p className="rounded-[6px] bg-primary/10 px-2.5 py-1.5 text-[12px] text-primary">{notice}</p>
      ) : null}
      {error ? (
        <p className="rounded-[6px] bg-destructive/10 px-2.5 py-1.5 text-[12px] text-destructive">{error}</p>
      ) : null}

      <div className="flex flex-wrap items-center gap-1.5">
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="搜索插件 / 标签 / 作者"
          aria-label="搜索插件"
          className="h-8 min-w-[180px] flex-1"
        />
        <select
          aria-label="分类"
          value={category}
          onChange={(event) => setCategory(event.target.value)}
          className="h-8 rounded-[6px] border-[0.5px] border-shell-border-l2 bg-card px-2 text-[12px] outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
        >
          {categories.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        <select
          aria-label="排序"
          value={sort}
          onChange={(event) => setSort(event.target.value as SortKey)}
          className="h-8 rounded-[6px] border-[0.5px] border-shell-border-l2 bg-card px-2 text-[12px] outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
        >
          {SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div className="rounded-[8px] border-[0.5px] border-shell-border px-2.5 py-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-medium text-shell-label-secondary">
            市场源：{source?.remote ? "远端在线 registry" : "本地目录"}
          </span>
          {source?.requireSignature ? <Badge tone="green">强制验签</Badge> : <Badge>验签可选</Badge>}
        </div>
        <div className="mt-1.5 flex items-center gap-1.5">
          <Input
            value={sourceDraft}
            onChange={(event) => setSourceDraft(event.target.value)}
            placeholder="https://example.com/registry.json（留空 = 本地目录）"
            aria-label="市场源 URL"
            className="h-8 flex-1 font-mono text-[11px]"
          />
          <Button variant="secondary" size="sm" onClick={() => void saveSource()} disabled={sourceBusy}>
            {sourceBusy ? "保存中…" : "保存"}
          </Button>
        </div>
      </div>

      <div className="-mr-2 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-2">
        {loading ? (
          [0, 1, 2].map((index) => <Skeleton key={index} className="h-[104px] w-full rounded-[10px]" />)
        ) : visible.length === 0 ? (
          <p className="rounded-[10px] border-[0.5px] border-dashed border-shell-border px-3 py-6 text-center text-[12px] text-shell-label-tertiary">
            {entries.length === 0 ? "市场里还没有插件。" : "没有匹配的插件。"}
          </p>
        ) : (
          visible.map((entry) => {
            const action = actionFor(entry);
            const current = installed.get(entry.id);
            const lastComment = entry.comments?.at(-1);
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
                    {entry.category ? <Badge>{entry.category}</Badge> : null}
                    {entry.source === "remote" ? <Badge tone="blue">远端</Badge> : <Badge>本地</Badge>}
                    {current?.updateAvailable ? <Badge tone="amber">可更新</Badge> : null}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    {entry.author ? (
                      <span className="text-[11px] text-shell-label-tertiary">{entry.author}</span>
                    ) : null}
                    <Stars rating={entry.rating} count={entry.ratingCount} />
                    <span className="text-[11px] text-shell-label-tertiary">
                      ↓ {entry.downloads ?? 0}
                    </span>
                  </div>
                  <p className="mt-1 text-[12px] leading-[17px] text-shell-label-tertiary">{entry.description}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    {(entry.capabilities ?? []).map((capability) => (
                      <Badge key={capability} tone="blue">
                        {capabilityLabel(capability)}
                      </Badge>
                    ))}
                    {(entry.tags ?? []).map((tag) => (
                      <Badge key={tag}>#{tag}</Badge>
                    ))}
                    {entry.signature ? <Badge tone="green">已签名</Badge> : null}
                    {entry.sha256 ? <Badge>有校验和</Badge> : null}
                  </div>
                  {lastComment ? (
                    <p className="mt-1 truncate text-[11px] text-shell-label-tertiary">
                      「{lastComment.text}」— {lastComment.rating}★
                    </p>
                  ) : null}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <Button
                    variant={action.kind === "enabled" ? "secondary" : "default"}
                    size="sm"
                    disabled={action.disabled || busyId === entry.id}
                    onClick={() => {
                      if (action.kind === "install" || action.kind === "update") {
                        setConfirmEntry(entry);
                        return;
                      }
                      if (action.kind === "enable") {
                        void enablePlugin(entry);
                        return;
                      }
                      if (action.kind === "approve") void approvePlugin(entry);
                    }}
                  >
                    {busyId === entry.id ? "处理中…" : action.label}
                  </Button>
                  {current ? (
                    <span className="text-[10px] leading-3 text-shell-label-tertiary">
                      {!current.enabled ? "未启用" : !current.approved ? "待批准" : "运行中"}
                    </span>
                  ) : null}
                  {current?.enabled && current.approved && (current.capabilities ?? []).includes("ui") ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busyId === entry.id}
                      onClick={() => window.location.reload()}
                    >
                      刷新页面
                    </Button>
                  ) : null}
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busyId === entry.id}
                    onClick={() => {
                      setRatingEntry(entry);
                      setRatingValue(Math.round(entry.rating ?? 5) || 5);
                      setRatingComment("");
                    }}
                  >
                    评分
                  </Button>
                </div>
              </div>
            );
          })
        )}
      </div>

      <Dialog open={confirmEntry !== null} onOpenChange={(open) => !open && setConfirmEntry(null)}>
        <DialogContent className="max-w-[480px]">
          <DialogHeader className="border-b-[0.5px] border-shell-border pb-3 text-left">
            <DialogTitle>
              {installed.get(confirmEntry?.id ?? "")?.updateAvailable ? "更新" : "安装"} · {confirmEntry?.name}
            </DialogTitle>
            <p className="text-[12px] text-shell-label-tertiary">
              {confirmEntry?.source === "remote" ? "来源：远端 registry" : "来源：本地市场"} · v
              {confirmEntry?.version}
            </p>
          </DialogHeader>
          <div className="flex flex-col gap-2 pt-1 text-[12px] text-shell-label-secondary">
            <div>
              <span className="font-medium">权限声明：</span>
              {(confirmEntry?.capabilities ?? []).length > 0
                ? (confirmEntry?.capabilities ?? []).map(capabilityLabel).join("、")
                : "清单未声明（安装时按 manifest 读取）"}
            </div>
            <div>
              <span className="font-medium">完整性：</span>
              {confirmEntry?.signature ? "已签名（安装时验签）" : confirmEntry?.sha256 ? "有 sha256 校验和" : "未提供校验和"}
            </div>
            <p className="rounded-[6px] bg-amber-500/10 px-2.5 py-1.5 text-[11px] leading-4 text-amber-800 dark:text-amber-200">
              宿主代码在 Lotion 进程内运行，客户端代码在浏览器执行；都不是安全沙箱。安装后默认停用。
            </p>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirmEntry(null)}>
              取消
            </Button>
            <Button
              onClick={() => confirmEntry && void install(confirmEntry)}
              disabled={busyId === confirmEntry?.id}
            >
              {busyId === confirmEntry?.id ? "处理中…" : "确认"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={ratingEntry !== null} onOpenChange={(open) => !open && setRatingEntry(null)}>
        <DialogContent className="max-w-[420px]">
          <DialogHeader className="border-b-[0.5px] border-shell-border pb-3 text-left">
            <DialogTitle>评分 · {ratingEntry?.name}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3 pt-1">
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-label={`${value} 星`}
                  onClick={() => setRatingValue(value)}
                  className={cn(
                    "text-[22px] leading-none transition-transform hover:scale-110",
                    value <= ratingValue ? "text-amber-500" : "text-shell-label-tertiary",
                  )}
                >
                  ★
                </button>
              ))}
            </div>
            <textarea
              value={ratingComment}
              onChange={(event) => setRatingComment(event.target.value.slice(0, 500))}
              placeholder="写一句评论（可选）"
              aria-label="评论"
              className="min-h-[80px] w-full resize-y rounded-[8px] border-[0.5px] border-shell-border-l2 bg-card p-2.5 text-[13px] leading-5 outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
            />
            {(ratingEntry?.comments ?? []).length > 0 ? (
              <div className="max-h-32 overflow-y-auto rounded-[8px] border-[0.5px] border-shell-border p-2">
                <p className="mb-1 text-[11px] font-medium text-shell-label-secondary">最近评论</p>
                {(ratingEntry?.comments ?? []).slice(-5).map((comment, index) => (
                  <div key={`${comment.createdAt}-${index}`} className="border-t-[0.5px] border-shell-border py-1 first:border-t-0">
                    <span className="text-[11px] text-amber-500">{"★".repeat(comment.rating)}</span>
                    <p className="text-[11px] leading-4 text-shell-label-tertiary">{comment.text}</p>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setRatingEntry(null)}>
              取消
            </Button>
            <Button onClick={() => void submitRating()} disabled={busyId === ratingEntry?.id}>
              {busyId === ratingEntry?.id ? "提交中…" : "提交评分"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
