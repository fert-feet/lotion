"use client";

// AI 面板的附件（文本类文件）：
//  - 读取：FileReader → 文本（图片/二进制读进来是乱码，直接拒绝）
//  - 校验：单文件 ≤ 20k 字符、单轮 ≤ 3 个（与服务端 normalizeAttachments 同规则）
//  - 展示：只带名称与字符数（正文发给服务端当上下文，不落库）
//
// 为什么要限制：AI 面板的附件是"把文件内容作为上下文喂给模型"，不是文件托管；
// 超限的文件应当引导用户改用编辑器上传或先摘要。

export const ATTACHMENT_MAX_COUNT = 3;
export const ATTACHMENT_MAX_CHARS = 20_000;

/** 可接受的扩展名（文本类） */
export const ATTACHMENT_EXTENSIONS = [".md", ".markdown", ".txt", ".json", ".csv", ".log", ".yml", ".yaml"];

export interface ChatAttachment {
  name: string;
  content: string;
}

export interface AttachmentRejection {
  name: string;
  reason: string;
}

/** 扩展名是否可接受（无扩展名的也放行：常用 .env/README 这类） */
export function isTextAttachmentName(name: string): boolean {
  const lower = name.toLowerCase();
  const dot = lower.lastIndexOf(".");
  // 无扩展名（README）与点开头无扩展名（.env）都放行
  if (dot <= 0) return true;
  return ATTACHMENT_EXTENSIONS.includes(lower.slice(dot));
}

/**
 * 校验一批待加入的附件：返回可接受的与拒绝原因（逐条给出，UI 用 toast/提示）。
 * 纯函数：不读文件、不碰 DOM。
 */
export function validateAttachments(
  incoming: Array<{ name: string; content: string }>,
  existingCount: number,
): { accepted: ChatAttachment[]; rejected: AttachmentRejection[] } {
  const accepted: ChatAttachment[] = [];
  const rejected: AttachmentRejection[] = [];
  let count = existingCount;
  for (const item of incoming) {
    if (count >= ATTACHMENT_MAX_COUNT) {
      rejected.push({ name: item.name, reason: `一次最多 ${ATTACHMENT_MAX_COUNT} 个附件` });
      continue;
    }
    if (!isTextAttachmentName(item.name)) {
      rejected.push({ name: item.name, reason: "只支持文本类文件（.md/.txt/.json/.csv 等）" });
      continue;
    }
    if (!item.content.trim()) {
      rejected.push({ name: item.name, reason: "文件是空的" });
      continue;
    }
    accepted.push({ name: item.name, content: item.content.slice(0, ATTACHMENT_MAX_CHARS) });
    count += 1;
    if (item.content.length > ATTACHMENT_MAX_CHARS) {
      rejected.push({
        name: item.name,
        reason: `超过 ${ATTACHMENT_MAX_CHARS} 字符，已截断`,
      });
    }
  }
  return { accepted, rejected };
}

/** 读取一个文件为文本附件（浏览器 FileReader；失败时 reject，由调用方提示） */
export function readAttachmentFile(file: File): Promise<{ name: string; content: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`读取「${file.name}」失败`));
    reader.onload = () => resolve({ name: file.name, content: String(reader.result ?? "") });
    reader.readAsText(file);
  });
}
