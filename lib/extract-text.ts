/**
 * 从 BlockNote JSON 内容中提取纯文本（每个 block 的文本段拼接，block 间换行）。
 * - 非 JSON / 非数组结构原样返回（兼容纯文本内容）
 * - 空 block 跳过
 */
export function extractText(content: string): string {
  try {
    const blocks = JSON.parse(content);
    if (!Array.isArray(blocks)) return content;
    return blocks
      .map((b: { content?: Array<{ text?: string }> }) =>
        b.content?.map((c) => c.text || "").join("") || ""
      )
      .filter(Boolean)
      .join("\n");
  } catch {
    return content;
  }
}
