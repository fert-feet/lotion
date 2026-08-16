// BlockNote JSON → Markdown 转换器（服务端专用：AI 工具/大纲等读旧数据用）。
// 不依赖 BlockNote 运行时（模块级 blocksToMarkdown 需要 prosemirror Schema + editor
// 实例，服务端无法构造），手写遍历块树，输出与编辑器 blocksToMarkdownLossy 同语义的
// Markdown。阶段 2 自研编辑器落地、存量数据统一迁移后本模块退役。

// ---- 最小 BlockNote 块结构（只读转换关心的字段） ----

interface BlockNode {
  type?: string;
  props?: Record<string, unknown>;
  content?: InlineNode[];
  children?: BlockNode[];
}

interface InlineNode {
  type?: string;
  text?: string;
  href?: string;
  styles?: Record<string, unknown>;
  content?: InlineNode[];
}

// ---- inline 渲染（text 样式 → Markdown 标记） ----

function renderInline(node: InlineNode): string {
  if (node.type === "text" || !node.type) {
    let t = node.text ?? "";
    const s = node.styles ?? {};
    // 样式嵌套顺序：code > link > bold > italic > strike（与常见 Markdown 生成器一致）
    if (s.code) t = "`" + t + "`";
    if (s.bold) t = "**" + t + "**";
    if (s.italic) t = "*" + t + "*";
    if (s.strike) t = "~~" + t + "~~";
    return t;
  }
  if (node.type === "link") {
    const inner = (node.content ?? []).map(renderInline).join("");
    const href = node.href ?? "";
    return href ? `[${inner}](${href})` : inner;
  }
  // 其他 inline 类型（emoji 等）降级为文本
  return node.text ?? (node.content ?? []).map(renderInline).join("");
}

// ---- block 渲染 ----

function renderBlock(block: BlockNode, depth = 0): string {
  const type = block.type ?? "paragraph";
  const indent = "  ".repeat(depth);
  const text = (block.content ?? []).map(renderInline).join("");

  switch (type) {
    case "heading": {
      const level = typeof block.props?.level === "number" ? Math.min(Math.max(block.props.level, 1), 6) : 1;
      return "#".repeat(level) + " " + text;
    }
    case "bulletListItem": {
      const body = text + renderChildren(block, depth);
      return indent + "- " + body;
    }
    case "numberedListItem": {
      const body = text + renderChildren(block, depth);
      return indent + "1. " + body;
    }
    case "todoListItem": {
      const checked = block.props?.checked === true;
      const body = (checked ? "- [x] " : "- [ ] ") + text + renderChildren(block, depth);
      return indent + body;
    }
    case "checkListItem": {
      const checked = block.props?.checked === true;
      return indent + (checked ? "- [x] " : "- [ ] ") + text + renderChildren(block, depth);
    }
    case "codeBlock": {
      const lang = typeof block.props?.language === "string" ? block.props.language : "";
      const code = text;
      return "```" + lang + "\n" + code + "\n```";
    }
    case "quote": {
      const lines = text.split("\n").map((l) => "> " + l);
      return lines.join("\n") + renderChildren(block, depth);
    }
    case "divider":
      return "---";
    case "paragraph":
    default: {
      if (!text && !(block.children?.length)) return "";
      return text + renderChildren(block, depth);
    }
  }
}

function renderChildren(block: BlockNode, depth: number): string {
  if (!block.children || block.children.length === 0) return "";
  const inner = block.children
    .map((c) => renderBlock(c, depth + 1))
    .filter(Boolean)
    .join("\n");
  return inner ? "\n" + inner : "";
}

/**
 * BlockNote blocks JSON → Markdown 文本。
 * 空内容返回空串；不支持的类型降级为段落文本（不丢文字）。
 */
export function blocksToMarkdown(blocks: BlockNode[]): string {
  return blocks
    .map((b) => renderBlock(b, 0))
    .filter(Boolean)
    .join("\n\n");
}
