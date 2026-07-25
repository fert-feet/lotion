/**
 * 将 markdown 字符串转换为 BlockNote PartialBlock[]。
 *
 * 支持的块类型：
 * - # ~ ###### → heading (level 1-6)
 * - - / *       → bulletListItem
 * - 1.          → numberedListItem
 * - ```         → codeBlock
 * - >           → paragraph（斜体）
 *
 * 支持的行内格式：
 * - **text**  → bold
 * - *text*    → italic
 * - ***text*** → bold + italic
 * - `text`    → code
 * - ~~text~~  → strikethrough
 */

type InlineStyle = {
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  strikethrough?: boolean;
};

type InlineNode = {
  type: "text";
  text: string;
  styles: InlineStyle;
};

type BlockNode = {
  id: string;
  type: "paragraph" | "heading" | "bulletListItem" | "numberedListItem" | "codeBlock";
  props?: Record<string, string | number | boolean>;
  content: InlineNode[];
};

// ---- 行内格式解析 ----

/**
 * 解析一行文本中的行内 markdown 格式，返回 InlineNode 数组。
 * 按优先级：先处理粗斜体、再粗体、再斜体、再代码、再删除线。
 */
function parseInline(text: string): InlineNode[] {
  // 使用占位符标记法：把 markdown 语法替换为不可见占位符，然后按占位符拆分
  const tokens: Array<{ text: string; style: InlineStyle }> = [];

  // 临时替换：用不可见字符包裹样式文本
  let processed = text;

  // 1. ***bold italic*** → \x01 ... \x01  (bold+italic)
  processed = processed.replace(/\*\*\*(.+?)\*\*\*/g, (_, t) =>
    `\x01${t}\x01`);
  // 2. **bold** → \x02 ... \x02
  processed = processed.replace(/\*\*(.+?)\*\*/g, (_, t) =>
    `\x02${t}\x02`);
  // 3. *italic* (不是 ** 的一部分)
  processed = processed.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, (_, t) =>
    `\x03${t}\x03`);
  // 4. `code`
  processed = processed.replace(/`(.+?)`/g, (_, t) =>
    `\x04${t}\x04`);
  // 5. ~~strikethrough~~
  processed = processed.replace(/~~(.+?)~~/g, (_, t) =>
    `\x05${t}\x05`);

  // 按占位符拆分并构建 InlineNode[]
  return splitByMarkers(processed);
}

const MARKER_REGEX = /([\x01-\x05])(.*?)\1/g;

function splitByMarkers(input: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = MARKER_REGEX.exec(input)) !== null) {
    // 占位符之前的纯文本
    if (match.index > lastIndex) {
      const plain = input.slice(lastIndex, match.index);
      if (plain) addText(nodes, plain, {});
    }

    const marker = match[1];
    const content = match[2];
    const style: InlineStyle =
      marker === "\x01" ? { bold: true, italic: true }
      : marker === "\x02" ? { bold: true }
      : marker === "\x03" ? { italic: true }
      : marker === "\x04" ? { code: true }
      : marker === "\x05" ? { strikethrough: true }
      : {};

    // 递归处理嵌套内容
    for (const inner of splitByMarkers(content)) {
      addText(nodes, inner.text, { ...inner.styles, ...style });
    }

    lastIndex = match.index + match[0].length;
  }

  // 剩余纯文本
  if (lastIndex < input.length) {
    addText(nodes, input.slice(lastIndex), {});
  }

  // 如果没有任何节点，添加一个空的
  if (nodes.length === 0) {
    nodes.push({ type: "text", text: "", styles: {} });
  }

  return nodes;
}

function addText(nodes: InlineNode[], text: string, styles: InlineStyle): void {
  // 合并相邻同样式节点
  const last = nodes[nodes.length - 1];
  if (last && JSON.stringify(last.styles) === JSON.stringify(styles)) {
    last.text += text;
  } else {
    nodes.push({ type: "text", text, styles });
  }
}

// ---- 块级解析 ----

export function markdownToBlocks(markdown: string): BlockNode[] {
  if (!markdown || !markdown.trim()) {
    return [{ id: "b-0", type: "paragraph", content: [] }];
  }

  const lines = markdown.split("\n");
  const blocks: BlockNode[] = [];
  let i = 0;
  let blockIndex = 0;

  while (i < lines.length) {
    const line = lines[i];

    // 代码块 ```
    if (line.trim().startsWith("```")) {
      const codeLines: string[] = [];
      i++; // skip opening ```
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```

      blocks.push({
        id: `b-${blockIndex++}`,
        type: "codeBlock",
        content: [{ type: "text", text: codeLines.join("\n"), styles: {} }],
      });
      continue;
    }

    // 空行 → 跳过
    if (line.trim() === "") {
      i++;
      continue;
    }

    // 标题 # ~ ######
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      blocks.push({
        id: `b-${blockIndex++}`,
        type: "heading",
        props: { level },
        content: parseInline(headingMatch[2]),
      });
      i++;
      continue;
    }

    // 无序列表 - 或 *
    const ulMatch = line.match(/^(\s*)[-*]\s+(.+)/);
    if (ulMatch) {
      blocks.push({
        id: `b-${blockIndex++}`,
        type: "bulletListItem",
        content: parseInline(ulMatch[2]),
      });
      i++;
      continue;
    }

    // 有序列表 1. 2. 等
    const olMatch = line.match(/^(\s*)\d+\.\s+(.+)/);
    if (olMatch) {
      blocks.push({
        id: `b-${blockIndex++}`,
        type: "numberedListItem",
        content: parseInline(olMatch[2]),
      });
      i++;
      continue;
    }

    // 引用 >
    if (line.trim().startsWith("> ")) {
      const text = line.trim().slice(2);
      const inlineNodes = parseInline(text).map((n) => ({
        ...n,
        styles: { ...n.styles, italic: true },
      }));
      blocks.push({
        id: `b-${blockIndex++}`,
        type: "paragraph",
        content: inlineNodes,
      });
      i++;
      continue;
    }

    // 默认 → 段落
    blocks.push({
      id: `b-${blockIndex++}`,
      type: "paragraph",
      content: parseInline(line),
    });
    i++;
  }

  if (blocks.length === 0) {
    blocks.push({ id: "b-0", type: "paragraph", content: [] });
  }

  return blocks;
}
