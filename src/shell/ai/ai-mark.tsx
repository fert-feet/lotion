"use client";

// AI 身份标识的**单一真相源**：Apple Intelligence 多色渐变 orb。
//
// 为什么单独抽一个文件：重构前 AI 的视觉身份散落在各处（面板头部一个扁平
// systemYellow 方块、草稿卡又一个、思考指示是一个系统蓝小圆点），三者互不相关，
// 用户看不出"这是同一个 AI"。现在统一走 .ai-orb（渐变定义在 globals.css），
// 换品牌只需改那一处 CSS。
//
// 用法：头部标题、空状态、草稿卡图标、工具活动点、思考指示。
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** 渐变 orb。size 为像素直径（Apple Intelligence 的标识是圆形，不是圆角方块）。 */
export function AiOrb({
  size = 20,
  running = false,
  icon,
  className,
}: {
  size?: number;
  /** 运行中：缓慢呼吸（AI 正在工作） */
  running?: boolean;
  /** 叠在 orb 上的白色图标（如 Sparkles） */
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size }}
      className={cn("ai-orb inline-flex flex-none items-center justify-center rounded-full", running && "ai-breathe", className)}
    >
      {icon}
    </span>
  );
}

/** 小号渐变点：工具活动行左侧、思考指示的脉冲点。 */
export function AiDot({
  size = 6,
  running = false,
  className,
}: {
  size?: number;
  running?: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size }}
      className={cn("ai-orb inline-block flex-none rounded-full", running && "ai-breathe", className)}
    />
  );
}
