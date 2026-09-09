"use client";

// Button —— macOS 按钮语言：
// 连续小圆角（6–8px，非胶囊）、13px 中等字重、按下有轻微缩放反馈、聚焦环 3px 系统蓝。
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import { Slot } from "./_primitives";

export type ButtonVariant = "default" | "outline" | "ghost" | "destructive" | "secondary" | "link" | "ai";
export type ButtonSize = "default" | "sm" | "lg" | "icon" | "icon-sm" | "icon-lg";

const variantClass: Record<ButtonVariant, string> = {
  // 主按钮：系统蓝（Apple 的 default push button）
  default:
    "bg-primary text-primary-foreground shadow-[0_1px_1.5px_rgba(0,0,0,0.12)] hover:bg-[color-mix(in_srgb,var(--primary)_88%,black)]",
  // 次按钮：填充灰（Apple 的 gray push button）
  secondary:
    "bg-secondary text-secondary-foreground hover:bg-[color-mix(in_srgb,var(--secondary)_80%,var(--foreground))]",
  // 描边按钮：半透明面 + 发丝边
  outline:
    "border-[0.5px] border-shell-border-l2 bg-[color-mix(in_srgb,var(--card)_70%,transparent)] text-foreground hover:bg-card",
  ghost: "text-foreground hover:bg-shell-row-hover",
  destructive:
    "bg-destructive text-white shadow-[0_1px_1.5px_rgba(0,0,0,0.12)] hover:bg-[color-mix(in_srgb,var(--destructive)_88%,black)]",
  link: "text-primary underline-offset-4 hover:underline",
  ai: "bg-ai text-ai-foreground shadow-[0_1px_1.5px_rgba(0,0,0,0.1)] hover:bg-[color-mix(in_srgb,var(--ai)_88%,black)]",
};

const sizeClass: Record<ButtonSize, string> = {
  default: "h-8 px-3.5",
  sm: "h-7 px-2.5 text-[12px]",
  lg: "h-10 px-5 text-[15px]",
  icon: "size-8",
  "icon-sm": "size-7",
  "icon-lg": "size-10",
};

export function Button({ className, variant = "default", size = "default", asChild = false, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize; asChild?: boolean }) {
  const cls = cn(
    "inline-flex shrink-0 cursor-pointer select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-[7px] text-[13px] font-medium leading-none",
    "transition-[background-color,box-shadow,transform] duration-150 ease-[var(--ds-ease-out)]",
    "active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40",
    "outline-none focus-visible:ring-[3px] focus-visible:ring-ring",
    variantClass[variant],
    sizeClass[size],
    className,
  );
  if (asChild) return <Slot className={cls} {...props}>{children}</Slot>;
  return <button type="button" className={cls} {...props}>{children}</button>;
}

export default Button;
