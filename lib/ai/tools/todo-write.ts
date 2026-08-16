import type Database from "better-sqlite3";
import { tool } from "ai";
import z from "zod";
import { logger } from "@/lib/logger";
import type { ToolEvent } from "./index";

export const TODO_STATUSES = ["pending", "in_progress", "completed", "cancelled"] as const;
export type TodoStatus = (typeof TODO_STATUSES)[number];
export interface TodoItem {
  content: string;
  status: TodoStatus;
}

export function createTodoWriteTool(
  db: Database.Database,
  userId: string,
  onEvent: (event: ToolEvent) => void = () => {},
) {
  return tool({
    description:
      "维护会话任务清单（每次调用整体替换列表）。多步任务（3 个及以上独立步骤）用此工具跟踪进度：开始某步前设为 in_progress，完成后设为 completed，状态变化时更新。单步请求不要使用。",
    inputSchema: z.object({
      todos: z
        .array(
          z.object({
            content: z.string().describe("任务内容（简洁，≤60 字）"),
            status: z
              .enum(TODO_STATUSES)
              .describe("状态：pending 待办 / in_progress 进行中 / completed 已完成 / cancelled 已取消"),
          }),
        )
        .describe("完整任务清单（替换式更新）"),
    }),
    execute: async ({ todos }: { todos: TodoItem[] }) => {
      if (!todos || todos.length === 0) {
        return "任务清单已清空。";
      }
      logger.tools.info("[todoWrite] 更新任务清单", { count: todos.length });
      onEvent({ type: "todo_update", items: todos });
      const done = todos.filter((t) => t.status === "completed").length;
      return `任务清单已更新（共 ${todos.length} 项，已完成 ${done} 项）。`;
    },
  });
}
