"use client";

// 自研 Button（对齐 DSH ui-primitives Button）：胶囊几何 + 语义色族，asChild 经 Slot 合并。
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import { Slot } from "./_primitives";

export type ButtonVariant = "default" | "outline" | "ghost" | "destructive" | "secondary" | "link" | "ai";
export type ButtonSize = "default" | "sm" | "lg" | "icon" | "icon-sm" | "icon-lg";

const variantClass: Record<ButtonVariant, string> = {
  default: "bg-primary text-primary-foreground hover:bg-primary/90",
  outline: "border border-border bg-transparent hover:bg-shell-row-hover",
  ghost: "hover:bg-shell-row-hover hover:text-foreground",
  destructive: "bg-destructive text-white hover:bg-destructive/90",
  secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
  link: "text-primary underline-offset-4 hover:underline",
  ai: "bg-ai text-ai-foreground hover:bg-ai/90",
};

const sizeClass: Record<ButtonSize, string> = {
  default: "h-9 px-4",
  sm: "h-7 px-3 text-xs",
  lg: "h-10 px-6",
  icon: "size-9",
  "icon-sm": "size-7",
  "icon-lg": "size-10",
};

export function Button({ className, variant = "default", size = "default", asChild = false, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize; asChild?: boolean }) {
  const cls = cn("inline-flex shrink-0 cursor-pointer select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-[18px] text-sm font-medium leading-[22px] transition-colors duration-100 outline-none disabled:pointer-events-none disabled:opacity-40", variantClass[variant], sizeClass[size], className);
  if (asChild) return <Slot className={cls} {...props}>{children}</Slot>;
  return <button type="button" className={cls} {...props}>{children}</button>;
}

export default Button;