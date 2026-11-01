"use client";

// Switch —— macOS 开关：38×22 轨道 + 17px 白色滑块，系统蓝填充。
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Switch({
  checked,
  onCheckedChange,
  className,
  disabled,
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> & {
  checked: boolean;
  onCheckedChange?: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange?.(!checked)}
      className={cn(
        "relative h-[22px] w-[38px] shrink-0 cursor-pointer rounded-full border-[0.5px] border-shell-border-l2",
        "transition-colors duration-150 ease-[var(--ds-ease-out)]",
        "outline-none focus-visible:ring-[3px] focus-visible:ring-ring",
        "disabled:cursor-not-allowed disabled:opacity-40",
        checked ? "bg-primary" : "bg-secondary",
        className,
      )}
      {...props}
    >
      <span
        aria-hidden
        className={cn(
          "absolute left-[2px] top-[2px] size-[16px] rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.22)]",
          "transition-transform duration-150 ease-[var(--ds-ease-out)]",
          checked && "translate-x-[16px]",
        )}
      />
    </button>
  );
}
