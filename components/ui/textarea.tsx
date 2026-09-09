import * as React from "react"

import { cn } from "@/lib/utils"

// Textarea —— 与 Input 同一套 macOS 文本框语言
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-[6px] border-[0.5px] border-shell-border-l2 bg-secondary px-2.5 py-2 text-[13px] leading-5 text-foreground",
        "placeholder:text-muted-foreground",
        "transition-[background-color,box-shadow] duration-150 ease-[var(--ds-ease-out)] outline-none",
        "focus-visible:border-primary focus-visible:bg-card focus-visible:ring-[3px] focus-visible:ring-ring",
        "aria-invalid:border-destructive aria-invalid:ring-destructive/25",
        "disabled:cursor-not-allowed disabled:opacity-45",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
