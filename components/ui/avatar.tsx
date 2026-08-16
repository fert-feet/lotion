"use client";

// 自研 Avatar（对齐 DSH 头像呈现）：首字母圆 + 可选图片，无第三方依赖
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

function Avatar({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "relative flex size-8 shrink-0 select-none items-center justify-center overflow-hidden rounded-full bg-shell-row-active text-xs font-medium text-shell-label-secondary",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export { Avatar };