import * as React from "react"

import { cn } from "@/lib/utils"

// Input —— macOS 文本框：填充灰底 + 发丝内边、6px 圆角、13px 字号，
// 聚焦时 3px 系统蓝环（Apple 的 focus ring）。
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "flex h-8 w-full min-w-0 rounded-[6px] border-[0.5px] border-shell-border-l2 bg-secondary px-2.5 py-1 text-[13px] leading-5 text-foreground",
        "placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground",
        "transition-[background-color,box-shadow] duration-150 ease-[var(--ds-ease-out)] outline-none",
        "file:mr-2 file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-[12px] file:font-medium file:text-foreground",
        "focus-visible:border-primary focus-visible:bg-card focus-visible:ring-[3px] focus-visible:ring-ring",
        "aria-invalid:border-destructive aria-invalid:ring-destructive/25",
        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-45",
        className
      )}
      {...props}
    />
  )
}

export { Input }
