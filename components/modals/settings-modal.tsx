"use client";

// 设置弹窗：左侧标签（外观 / 插件），右侧内容。
// 所有登录用户权限一致，插件页不再按 owner 隐藏。
import { useState } from "react";
import useSettings from "@/hooks/use-setting";
import { cn } from "@/lib/utils";
import { ModeToggle } from "@/components/lightButton";
import { PluginSettings } from "@/components/settings/plugin-settings";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

type Tab = "appearance" | "plugins";

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-current={active ? "page" : undefined}
      onClick={onClick}
      className={cn(
        "w-full rounded-control px-2 py-1.5 text-left text-ui transition-colors duration-150",
        active
          ? "bg-card font-medium text-shell-label-primary shadow-elevation-1"
          : "text-shell-label-secondary hover:bg-shell-row-hover",
      )}
    >
      {children}
    </button>
  );
}

const SettingsModal = () => {
  const settings = useSettings();
  const [tab, setTab] = useState<Tab>("appearance");

  return (
    <Dialog open={settings.isOpen} onOpenChange={settings.onClose}>
      <DialogContent className="max-h-[min(82vh,720px)] max-w-[720px] overflow-hidden p-0">
        <DialogHeader className="sr-only">
          <DialogTitle>设置</DialogTitle>
        </DialogHeader>

        <div className="flex h-[min(72vh,560px)] min-h-[380px]">
          <nav
            aria-label="设置导航"
            className="flex w-[148px] shrink-0 flex-col gap-0.5 overflow-y-auto hairline-r border-shell-border bg-secondary/40 p-2.5"
          >
            <TabButton active={tab === "appearance"} onClick={() => setTab("appearance")}>
              外观
            </TabButton>
            <TabButton active={tab === "plugins"} onClick={() => setTab("plugins")}>
              插件
            </TabButton>
          </nav>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden p-5 pr-12">
            {tab === "appearance" ? (
              <div className="flex flex-col gap-4">
                <div>
                  <h2 className="text-lead font-semibold tracking-[-0.01em] text-shell-label-primary">
                    外观
                  </h2>
                </div>
                <div className="flex items-center justify-between rounded-card hairline border-shell-border px-3 py-2.5">
                  <Label>主题</Label>
                  <ModeToggle />
                </div>
              </div>
            ) : (
              <PluginSettings />
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default SettingsModal;
