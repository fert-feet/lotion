// contentEditable DOM → inline Markdown 转换器（编辑器提交时把编辑后的
// 富文本 DOM 序列化为 Markdown 落库）。接受最小 DOM 接口（NodeLike），
// 单测可构造 fake 节点，不依赖 jsdom。
//
// 支持：文本 / <strong> <em> <del> <code> <a> / <br> / 嵌套组合；
// 其余标签（样式 span 等）降级取文本内容，不做转义注入（只输出白名单标记）。

export interface NodeLike {
  nodeType: number;
  nodeName: string;
  textContent: string | null;
  href?: string;
  childNodes?: NodeLike[];
}

export const TEXT_NODE = 3;
export const ELEMENT_NODE = 1;

/** 递归把 DOM 子树转为 inline Markdown 文本 */
export function domToMarkdown(node: NodeLike): string {
  if (node.nodeType === TEXT_NODE) {
    return node.textContent ?? "";
  }
  const name = node.nodeName.toLowerCase();
  const children = (node.childNodes ?? []).map(domToMarkdown).join("");

  switch (name) {
    case "strong":
    case "b":
      return children ? `**${children}**` : "";
    case "em":
    case "i":
      return children ? `*${children}*` : "";
    case "del":
    case "s":
    case "strike":
      return children ? `~~${children}~~` : "";
    case "code":
      return children ? `\`${children}\`` : "";
    case "a": {
      const href = node.href ?? "";
      return href && children ? `[${children}](${href})` : children;
    }
    case "br":
      return "\n";
    default:
      // div/p/span/未知标签：降级为文本内容（换行由 <br> 负责）
      return children;
  }
}

/**
 * 从 contentEditable 元素序列化 Markdown（去掉末尾换行）。
 * 真实 DOM 节点经适配转为 NodeLike（NodeList 转数组），
 * 单测可直接传 fake NodeLike 给 domToMarkdown。
 * @param el - contentEditable 元素。
 * @returns 行内 Markdown 文本（段落内换行保留）。
 */
export function serializeEditable(el: HTMLElement): string {
  return domToMarkdown(adaptDom(el)).replace(/\n+$/, "");
}

/** 真实 DOM 节点 → NodeLike（childNodes 转数组） */
function adaptDom(el: Node): NodeLike {
  return {
    nodeType: el.nodeType,
    nodeName: el.nodeName,
    textContent: el.textContent,
    href: (el as HTMLAnchorElement).href,
    childNodes: Array.from(el.childNodes).map(adaptDom),
  };
}
