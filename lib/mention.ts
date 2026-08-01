/**
 * 文档提及（@mention）的序列化协议。
 *
 * 前端胶囊输入框把选中的文档序列化为 `[@标题](文档id)` 文本发送，
 * 服务端/Agent 通过此模块解析出用户提及了哪些文档。
 */

export interface Mention {
  title: string;
  id: string;
}

// 标题允许任意字符（不含 ]）；id 宽松匹配 uuid/短 id
const MENTION_SOURCE = /\[@([^\]]+)\]\(([a-zA-Z0-9-]{3,64})\)/g;

/** 提取文本中所有文档提及，同一文档 id 去重，空标题跳过 */
export function extractMentions(text: string): Mention[] {
  const mentions: Mention[] = [];
  const seen = new Set<string>();
  // 每次调用创建新正则实例，避免模块级 g 正则 lastIndex 状态泄漏
  const regex = new RegExp(MENTION_SOURCE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    const title = m[1].trim();
    const id = m[2];
    if (!title || !id) continue;
    if (seen.has(id)) continue; // 同一文档只保留首次提及
    seen.add(id);
    mentions.push({ title, id });
  }
  return mentions;
}

/** 胶囊标题截断：超过 maxChars 个字时截断并加省略号（完整标题保留在悬停提示/序列化中） */
export function truncateMentionTitle(title: string, maxChars = 4): string {
  const t = title.trim();
  if (t.length <= maxChars) return t;
  return t.slice(0, maxChars) + "…";
}
