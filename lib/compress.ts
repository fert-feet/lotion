import { generateText } from "ai";
import { deepSeek } from "@ai-sdk/deepseek";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getChatHistory, getChatSessionSummary, updateChatSessionSummary, markMessagesCompressed } from "./db";
import { logger } from "./logger";

/**
 * 会话上下文压缩（滑动窗口 + 模型决定摘要）：
 * - 触发：assistant 消息落库后异步调用（fire-and-forget），未压缩消息总字符数超阈值才压缩
 * - 决策：模型从候选消息中挑选需要保留原文的（keep 列表），其余压缩进 summary
 * - 硬约束：最近 KEEP_FLOOR 条必留原文（保真地板）、keep 上限、摘要长度上限
 * - 降级：JSON 解析失败 / 模型异常 → 本轮不压缩，下次落库后重试；永不损坏对话
 * - 摘要为重写式：旧摘要 + 本轮滚出的消息 → 新摘要（不增量拼接）
 */

// ---- 参数 ----
const COMPRESS_MODEL = process.env.AI_MODEL || "deepseek-v4-flash";
const COMPRESS_TRIGGER_CHARS = 30_000; // 未压缩消息总字符数超过此值触发压缩
const COMPRESS_INPUT_CHARS = 60_000; // 模型输入预算（极端兜底：连续压缩失败导致未压缩消息暴涨时从最旧截断）
const KEEP_FLOOR = 5; // 最近 N 条必留原文（保真地板，防止模型把用户刚说的话也压掉）
const KEEP_MAX = 40; // keep 列表上限（防模型偷懒全部保留导致压缩失效）
const SUMMARY_MAX_CHARS = 800; // 摘要长度上限

const COMPRESS_SYSTEM = `你是对话记忆压缩器。把一段对话压缩成摘要，作为 AI 助手后续对话的早期记忆。
规则：
- 用中文，按时间顺序组织，提炼事实与决策，不要寒暄和过程细节。
- 必须保留：用户的目标、偏好、明确要求；AI 的承诺；所有涉及笔记操作的文档标题与 id（格式 [标题](id)），后续可能要用 readNote 精确定位。
- 只输出一个 JSON 对象，不要输出其他任何内容。`;

/** 参与压缩的单条消息（id 用于 keep 选择与 compressed 标记） */
export interface CompressMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

/** 模型压缩决策 */
export interface CompressResult {
  keep: string[]; // 需要保留原文的消息 id
  summary: string; // 其余消息的摘要
}

/** 构造压缩 prompt（纯函数，便于单测） */
export function buildCompressPrompt(
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
    ? `\n\n已有早期摘要（本次将其与下列消息合并重写为新的完整摘要）：\n${oldSummary}`
    : "";
  return `${body}${old}

输出 JSON：{"keep": ["消息id", ...], "summary": "摘要"}
- keep：你认为需要保留原文的消息 id 列表（最多 ${KEEP_MAX} 条；最近 ${KEEP_FLOOR} 条系统已自动保留，无需列出）。
- summary：其余消息的压缩摘要，不超过 ${SUMMARY_MAX_CHARS} 字符。`;
}

/** 解析模型输出的 JSON（纯函数：容忍代码围栏与前后杂文本，失败返回 null） */
export function parseCompressResult(text: string): CompressResult | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(candidate.slice(start, end + 1)) as Partial<CompressResult>;
    if (!Array.isArray(parsed.keep) || typeof parsed.summary !== "string") return null;
    return {
      keep: parsed.keep.filter((id): id is string => typeof id === "string"),
      summary: parsed.summary,
    };
  } catch {
    return null;
  }
}

/** 应用硬约束（纯函数）：地板必留 + keep 上限 + 摘要截断；结果无意义时返回 null 降级 */
export function applyCompressConstraints(
  result: CompressResult,
  messages: CompressMessage[],
): { keepSet: Set<string>; summary: string } | null {
  const candidateIds = new Set(messages.map((m) => m.id));

  // 地板：最近 KEEP_FLOOR 条必留原文
  const keepSet = new Set(messages.slice(-KEEP_FLOOR).map((m) => m.id));

  // 模型 keep 只接受候选池内的 id
  for (const id of result.keep) {
    if (candidateIds.has(id)) keepSet.add(id);
  }

  // keep 上限（含地板）
  if (keepSet.size > KEEP_MAX) {
    const overflow = Array.from(keepSet).slice(KEEP_MAX);
    for (const id of overflow) keepSet.delete(id);
  }

  const summary = result.summary.trim().slice(0, SUMMARY_MAX_CHARS);

  // 全部保留或摘要为空 = 压缩无意义，降级不压缩
  if (keepSet.size >= messages.length || summary.length === 0) return null;

  return { keepSet, summary };
}

/**
 * 压缩入口：检查未压缩消息总量，超阈值则生成摘要并标记。
 * 幂等：summary 重写式更新 + compressed 按 id 快照标记；并发重复调用只多算一次，无脏数据。
 * 任何失败都降级为"本轮不压缩"（log + return），不抛异常。
 *
 * 并发安全：fire-and-forget 可能因下一轮消息到达而重叠触发，按会话串行化
 * （进程内 Promise 链），防止旧快照后完成覆盖新摘要、导致已标记消息内容永久丢失。
 */
const sessionLocks = new Map<string, Promise<void>>();

export async function maybeCompressSession(
  supabase: SupabaseClient,
  userId: string,
  sessionId: string,
): Promise<void> {
  const prev = sessionLocks.get(sessionId) ?? Promise.resolve();
  const run = prev.then(() => runCompress(supabase, userId, sessionId));
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
  supabase: SupabaseClient,
  userId: string,
  sessionId: string,
): Promise<void> {
  try {
    const [oldSummary, history] = await Promise.all([
      getChatSessionSummary(supabase, userId, sessionId),
      getChatHistory(userId, sessionId, undefined, supabase, { uncompressedOnly: true }),
    ]);

    const messages: CompressMessage[] = history.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
    }));
    const totalChars = messages.reduce((sum, m) => sum + m.content.length, 0);

    if (totalChars <= COMPRESS_TRIGGER_CHARS) {
      logger.compress.info("未达压缩阈值，跳过", { sessionId, totalChars, threshold: COMPRESS_TRIGGER_CHARS });
      return;
    }

    // 输入预算兜底：连续压缩失败导致未压缩消息暴涨时，保留最近的消息参与压缩，
    // 最旧部分本次不参与（不标记，下次重试；日志告警）
    let input = messages;
    if (totalChars > COMPRESS_INPUT_CHARS) {
      input = [];
      let chars = 0;
      for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i];
        chars += m.content.length;
        if (chars > COMPRESS_INPUT_CHARS) break;
        input.unshift(m);
      }
      logger.compress.warn("未压缩消息超过输入预算，最旧部分本次不参与压缩", {
        sessionId,
        totalChars,
        inputChars: input.reduce((s, m) => s + m.content.length, 0),
      });
    }

    const { text } = await generateText({
      model: deepSeek(COMPRESS_MODEL),
      system: COMPRESS_SYSTEM,
      prompt: buildCompressPrompt(input, oldSummary),
      maxOutputTokens: 2_000,
    });

    const parsed = parseCompressResult(text);
    if (!parsed) {
      logger.compress.warn("压缩输出解析失败，本轮不压缩", { sessionId, text: text.slice(0, 200) });
      return;
    }

    const constrained = applyCompressConstraints(parsed, input);
    if (!constrained) {
      logger.compress.warn("压缩结果被硬约束否决（全部保留或摘要为空），本轮不压缩", { sessionId });
      return;
    }

    const { keepSet, summary } = constrained;
    const compressedIds = input.filter((m) => !keepSet.has(m.id)).map((m) => m.id);

    // 先写摘要再标记消息：摘要落库失败则消息保持未压缩（下次重试），不产生"已标记但无摘要"的中间态
    await updateChatSessionSummary(supabase, userId, sessionId, summary);
    if (compressedIds.length > 0) {
      await markMessagesCompressed(supabase, userId, compressedIds);
    }

    logger.compress.info("压缩完成", {
      sessionId,
      totalChars,
      inputCount: input.length,
      keptCount: keepSet.size,
      compressedCount: compressedIds.length,
      summaryChars: summary.length,
      withOldSummary: !!oldSummary,
    });
  } catch (e) {
    logger.compress.error("压缩失败，降级为不压缩", { sessionId, error: String(e) });
  }
}
