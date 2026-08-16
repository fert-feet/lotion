import type Database from "better-sqlite3";
import { tool } from "ai";
import z from "zod";
import { logger } from "@/lib/logger";
import type { ToolEvent } from "./index";

/** 单请求内最多提问次数（多问会打断对话流；等待回答时模型应结束本轮） */
const MAX_ASK_PER_REQUEST = 1;

export function createAskUserTool(
  db: Database.Database,
  userId: string,
  onEvent: (event: ToolEvent) => void = () => {},
) {
  // 幂等防重（对齐 createNote 模式）：一次请求只问一轮，避免连环提问阻塞对话
  let asked = false;

  return tool({
    description:
      "向用户提出结构化问题以澄清需求或偏好（选择项/确认意图）。仅当信息不足无法继续时才使用，不要用普通文本列表替代；用户回答会作为后续消息到来。",
    inputSchema: z.object({
      questions: z
        .array(
          z.object({
            header: z.string().describe("简短标签（≤30 字）"),
            question: z.string().describe("完整问题文本"),
            options: z
              .array(
                z.object({
                  label: z.string().describe("选项显示文本（1-5 词，简洁）"),
                  description: z.string().describe("该选项的说明"),
                }),
              )
              .describe("可选答案列表"),
            multiple: z.boolean().optional().describe("是否允许多选（默认 false）"),
            custom: z.boolean().optional().describe("是否允许自定义输入（默认 true）"),
          }),
        )
        .describe("问题数组（1-3 个）"),
    }),
    execute: async ({ questions }: { questions: AskQuestion[] }) => {
      if (asked) {
        logger.tools.warn("[askUser] 拒绝重复提问");
        return "你已经在等待用户回答前面的问题了。请基于用户的回答继续，不要重复提问。";
      }
      if (!questions || questions.length === 0) {
        return "提问失败：questions 不能为空。";
      }
      if (questions.length > MAX_ASK_PER_REQUEST) {
        return `提问失败：一次最多问 ${MAX_ASK_PER_REQUEST} 个问题。`;
      }
      asked = true;

      logger.tools.info("[askUser] 向用户提问", { count: questions.length });
      onEvent({ type: "question", questions });
      return "已向用户提出结构化问题（界面已展示选项）。请结束本轮回复，等待用户的回答消息后再继续。";
    },
  });
}

export interface AskQuestion {
  header: string;
  question: string;
  options: Array<{ label: string; description: string }>;
  multiple?: boolean;
  custom?: boolean;
}
