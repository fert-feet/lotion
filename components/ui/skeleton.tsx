"use client";

// Skeleton：macOS 加载占位（低对比填充色 + 呼吸式淡入淡出，不用高对比闪烁）
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("animate-pulse rounded-[6px] bg-[color-mix(in_srgb,var(--foreground)_8%,transparent)]", className)}
      {...props}
    />
  );
}

export { Skeleton };
