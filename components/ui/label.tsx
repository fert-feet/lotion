"use client";

// 自研 Label：语义 label（无 radix 依赖）
import type { LabelHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("text-sm font-medium leading-5 text-shell-label-primary", className)} {...props} />;
}

export { Label };
