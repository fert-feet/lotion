"use client";

// Avatar：圆形头像（Apple 用连续圆角/正圆，配发丝描边）
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

function Avatar({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "relative flex size-7 shrink-0 select-none items-center justify-center overflow-hidden rounded-full bg-secondary text-[11px] font-semibold text-shell-label-secondary",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export { Avatar };
