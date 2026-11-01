"use client";

// 动态插件源码预览（只读）。宿主半边 / 客户端半边分块展示。
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { PluginInfo, PluginSourceCode } from "@/lib/seams/plugins";

export function PluginSourceDialog({
  plugin,
  source,
  open,
  onOpenChange,
}: {
  plugin: PluginInfo | null;
  source: PluginSourceCode | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const parts = [
    { key: "host", title: "宿主半边（node:vm）", code: source?.host },
    { key: "client", title: "客户端半边（需审批）", code: source?.client },
  ].filter((part): part is { key: string; title: string; code: string } => typeof part.code === "string");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[760px]">
        <DialogHeader className="border-b-[0.5px] border-shell-border pb-3 text-left">
          <DialogTitle>源码 · {plugin?.title ?? "动态插件"}</DialogTitle>
          <p className="text-[12px] text-shell-label-tertiary">
            沙箱不是安全边界：这段代码与本机同信任级别，运行前请自行审阅。
          </p>
        </DialogHeader>

        <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto pt-1">
          {parts.length === 0 ? (
            <p className="text-[12px] text-shell-label-tertiary">没有可预览的源码。</p>
          ) : (
            parts.map((part) => (
              <section key={part.key} className="flex flex-col gap-1.5">
                <h3 className="text-[12px] font-semibold text-shell-label-secondary">{part.title}</h3>
                <pre className="max-h-64 overflow-auto rounded-[8px] border-[0.5px] border-shell-border-l2 bg-secondary/60 p-3 font-mono text-[11px] leading-[17px] text-foreground">
                  <code>{part.code}</code>
                </pre>
              </section>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
