// 统一空状态：此前三个页面各写一套（图标 64/48/56px、标题 22/16/18px、
// 按钮 36/28/30px —— 9 个值全不一样），因为每次都是就地手搓。
//
// 两个形态：
//   page   —— 整页/整面板的"欢迎/空"占位（带图标、标题、说明、主操作）
//   inline —— 列表内的一行占位（虚线框 + 一句话），用于插件市场/设置列表
//
// 尺寸全部取自 --text-* / --radius-* 刻度，禁止在调用方再写 text-[Npx]。
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface EmptyStateProps {
  /** page 形态的图标（emoji / 图标组件）；inline 形态忽略 */
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  /** 主操作（page 形态渲染在说明下方） */
  action?: ReactNode;
  variant?: "page" | "inline";
  className?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  variant = "page",
  className,
}: EmptyStateProps) {
  if (variant === "inline") {
    return (
      <p
        className={cn(
          "rounded-card hairline border-dashed border-shell-border px-3 py-6",
          "text-center text-ui-sm text-shell-label-tertiary",
          className,
        )}
      >
        {title}
      </p>
    );
  }

  return (
    <div className={cn("flex flex-col items-center justify-center px-6 text-center", className)}>
      {icon !== undefined && (
        <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-card bg-secondary text-shell-label-tertiary shadow-elevation-1">
          <span className="flex h-5 w-5 items-center justify-center text-lead">{icon}</span>
        </div>
      )}
      <h2 className="text-lead font-semibold tracking-[-0.01em] text-foreground">{title}</h2>
      {description !== undefined && (
        <p className="mt-1.5 max-w-[32ch] text-ui leading-[1.5] text-muted-foreground">{description}</p>
      )}
      {action !== undefined && <div className="mt-4">{action}</div>}
    </div>
  );
}
