"use client";

// 自研 Skeleton：shimmer 占位（对齐 DSH 骨架屏风格）
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("animate-pulse rounded-md bg-shell-row-active", className)} {...props} />;
}

export { Skeleton };
