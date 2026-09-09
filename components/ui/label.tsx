"use client";

// Label —— macOS 表单标签：12px、次要色，比正文低一档
import type { LabelHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("text-[12px] font-medium leading-4 text-shell-label-secondary", className)} {...props} />;
}

export { Label };
