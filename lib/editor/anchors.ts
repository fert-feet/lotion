// 块锚点（阶段 3，对齐 SiYuan 块 ID 的轻量方案）：Pandoc 风格 `{#id}` 行尾标记。
// - 解析：块文本尾部识别锚点 → meta.anchor（代码块取最后一行）
// - 编辑保留：ops 重建块源时自动追加锚点
// - 渲染剥离：编辑器静态渲染 / readNote 全文输出时剥离（代码块围栏内不剥离）
// - AI 定位：getDocBlocks 列出锚点，updateBlock 按锚点/序号精确更新单块

/** 行尾锚点：`文本 {#id}`（id 允许字母数字、中划线、下划线、中文） */

/** 从单行文本提取锚点：返回 { id, text }（无锚点时 id 为 null） */
export function extractAnchor(line: string): { id: string | null; text: string } {
  const m = line.match(/\s*\{#([A-Za-z0-9_\-[\u4e00-\u9fa5]+)\}\s*$/);
  if (!m) return { id: null, text: line };
  return { id: m[1], text: line.slice(0, line.length - m[0].length).replace(/\s+$/, "") };
}

/**
 * 全文剥离锚点（AI 读正文 / 搜索结果摘要用）：
 * 跳过代码块围栏内容（``` 之间的 {#id} 是代码而非锚点），
 * 其余行行尾锚点剥离。
 */
export function stripAnchorsFromMarkdown(markdown: string): string {
  const lines = markdown.split("\n");
  let inFence = false;
  const out = lines.map((line) => {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      return line;
    }
    if (inFence) return line;
    return line.replace(/\s*\{#[^}\n]*\}\s*$/, "");
  });
  return out.join("\n");
}

/** 单行剥离锚点（inline 文本节点用） */
export function stripAnchorFromLine(line: string): string {
  return line.replace(/\s*\{#[^}\n]*\}\s*$/, "");
}

/**
 * 克隆 mdast 树并剥离锚点（编辑器静态渲染用）：
 * 只改 text 节点的值，position/结构原样保留（源切片偏移不变）。
 */
export function cloneRootWithoutAnchors(root: import("mdast").Root): import("mdast").Root {
  const clone: import("mdast").Root = { ...root, children: root.children.map(cloneNode) };
  return clone;
}

function cloneNode(node: import("mdast").RootContent): import("mdast").RootContent {
  if (node.type === "text") {
    return { ...node, value: stripAnchorFromLine(node.value) };
  }
  const anyNode = node as import("mdast").RootContent & { children?: unknown[] };
  if (Array.isArray(anyNode.children)) {
    return { ...node, children: anyNode.children.map((c) => cloneNode(c as import("mdast").RootContent)) } as import("mdast").RootContent;
  }
  return { ...node };
}
