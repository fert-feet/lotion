import { generateText } from "ai";
import { createAiModel, resolveAiRuntimeConfig, type AiRuntimeConfig } from "@/lib/ai/runtime-config";
import { getDb } from "./local/sqlite";
import {
  listChatHistory,
  getChatSessionSummary,
  setChatSessionSummary,
  markMessagesCompressed,
} from "./local/db";
import { logger } from "./logger";

/**
 * 会话上下文压缩（滑动窗口 + 摘要）：
 * - 窗口：最近 WINDOW_SIZE 条未压缩消息保留原文，滑出窗口的最旧部分压进摘要
 * - 决策：确定性窗口，不交给模型挑选（移除 keep 机制）；模型只负责把窗口外消息总结成摘要
 * - 摘要：重写式——旧摘要 + 本轮滑出的消息 → 新摘要（不增量拼接），先写摘要再标记消息
 * - 降级：摘要输出无效 / 模型异常 → 本轮不压缩，下次落库后重试；永不损坏对话
 * - 并发：fire-and-forget 可能重叠触发，按会话串行化（进程内 Promise 链），
 *   防止旧快照后完成覆盖新摘要、导致已标记消息内容永久丢失
 */

// ---- 参数 ----
export const WINDOW_SIZE = 100; // 滑动窗口：最近 100 条消息（50 轮）保留原文
const COMPRESS_BATCH_MAX = 500; // 单次最多压多少条（防极端暴涨，被截掉的最旧部分不参与也不标记）
const SUMMARY_MAX_CHARS = 800; // 摘要长度上限

const COMPRESS_SYSTEM = `你是对话记忆压缩器。把一段对话压缩成摘要，作为 AI 助手后续对话的早期记忆。
规则：
- 用中文，按时间顺序组织，提炼事实与决策，不要寒暄和过程细节。
- 必须保留：用户的目标、偏好、明确要求；AI 的承诺；所有涉及笔记操作的文档标题与 id（格式 [标题](id)），后续可能要用 readNote 精确定位。
- 只输出摘要正文，不要输出其他任何内容。`;

/** 参与压缩的单条消息 */
export interface CompressMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

/** 构造总结 prompt（纯函数，便于单测）：窗口外消息 + 旧摘要 → 重写式新摘要 */
export function buildSummaryPrompt(
  messages: CompressMessage[],
  oldSummary?: string | null,
): string {
  const lines = messages.map(
    (m) => `[${m.role}] ${m.content}`
  );
  const body = [
    `对话内容（按时间顺序）：`,
    ...lines.map((l) => `---\n${l}`),
    `---`,
  ].join("\n");
  const old = oldSummary
    ? `\n\n已有早期摘要（本次将其与下列消息合并重写为新的完整摘要，不要保留已过期内容）：\n${oldSummary}`
    : "";
  return `${body}${old}

输出：一段连续的中文摘要，不超过 ${SUMMARY_MAX_CHARS} 字符，直接输出摘要正文，不要代码围栏。`;
}

/** 提取模型输出的摘要（纯函数：容忍代码围栏与前后杂文本，空/无效返回 null） */
export function extractSummary(text: string): string | null {
  const fenced = text.match(/```(?:text|markdown)?\s*([\s\S]*?)```/);
  const candidate = (fenced ? fenced[1] : text).trim();
  if (!candidate) return null;
  return candidate.slice(0, SUMMARY_MAX_CHARS);
}

/**
 * 压缩入口：未压缩消息超过窗口则把最旧溢出部分压进摘要并标记。
 * 幂等：summary 重写式更新 + compressed 按 id 快照标记；并发重复调用只多算一次，无脏数据。
 * 任何失败都降级为"本轮不压缩"（log + return），不抛异常。
 */
const sessionLocks = new Map<string, Promise<void>>();

export async function maybeCompressSession(
  userId: string,
  sessionId: string,
  options?: { ai?: Partial<AiRuntimeConfig> },
): Promise<void> {
  const ai = resolveAiRuntimeConfig(options?.ai);
  const prev = sessionLocks.get(sessionId) ?? Promise.resolve();
  const run = prev.then(() => runCompress(userId, sessionId, ai));
  // 锁链存"永不 reject"的版本：runCompress 内部已兜底，此处防意外 reject 污染后续调用
  const tracked = run.catch(() => {});
  sessionLocks.set(sessionId, tracked);
  try {
    await run;
  } finally {
    if (sessionLocks.get(sessionId) === tracked) {
      sessionLocks.delete(sessionId);
    }
  }
}

async function runCompress(
  userId: string,
  sessionId: string,
  ai: AiRuntimeConfig,
): Promise<void> {
  try {
    const db = getDb();
    const [oldSummary, history] = await Promise.all([
      getChatSessionSummary(db, userId, sessionId),
      listChatHistory(db, userId, sessionId, undefined, { uncompressedOnly: true }),
    ]);

    const messages: CompressMessage[] = history.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
    }));

    // 窗口判定：未压缩消息仍在窗口内（含恰好等于窗口）时不压缩
    if (messages.length <= WINDOW_SIZE) {
      logger.compress.info("未超过滑动窗口，跳过", {
        sessionId,
        count: messages.length,
        windowSize: WINDOW_SIZE,
        remaining: WINDOW_SIZE - messages.length,
      });
      return;
    }

    // 滑出窗口的部分：最旧 (length - WINDOW_SIZE) 条参与压缩（最近窗口内保留原文）
    const overflow = messages.slice(0, messages.length - WINDOW_SIZE);

    // 输入预算兜底：溢出消息极端暴涨时只保留最近的一部分参与压缩，
    // 被截掉的最旧部分本次不参与（不标记，下次重试；日志告警）
    let input = overflow;
    if (overflow.length > COMPRESS_BATCH_MAX) {
      input = overflow.slice(overflow.length - COMPRESS_BATCH_MAX);
      logger.compress.warn("溢出消息超过批次上限，最旧部分本次不参与压缩", {
        sessionId,
        overflowCount: overflow.length,
        batchMax: COMPRESS_BATCH_MAX,
        inputCount: input.length,
      });
    }

    const { text } = await generateText({
      model: createAiModel(ai),
      system: COMPRESS_SYSTEM,
      prompt: buildSummaryPrompt(input, oldSummary),
      maxOutputTokens: 2_000,
    });

    const summary = extractSummary(text);
    if (!summary) {
      logger.compress.warn("摘要输出无效，本轮不压缩", { sessionId, text: text.slice(0, 200) });
      return;
    }

    // 先写摘要再标记消息：摘要落库失败则消息保持未压缩（下次重试），不产生"已标记但无摘要"的中间态
    setChatSessionSummary(db, userId, sessionId, summary);
    markMessagesCompressed(db, userId, input.map((m) => m.id));

    logger.compress.info("压缩完成", {
      sessionId,
      count: messages.length,
      windowSize: WINDOW_SIZE,
      overflowCount: input.length,
      summaryChars: summary.length,
      withOldSummary: !!oldSummary,
    });
  } catch (e) {
    logger.compress.error("压缩失败，降级为不压缩", { sessionId, error: String(e) });
  }
}
