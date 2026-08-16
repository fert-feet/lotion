// 对齐 DSH（deepseek-harness packages/client/ui-primitives/src/markdown/render.tsx）：
// 直接 mdast→React 的 markdown 渲染器，替代 react-markdown / remark-rehype 管线——
// 一条 switch 遍历节点，使流式渲染能缓存冻结块为 React 元素。
//
// 不可信输出策略（与 DSH 一致）：链接/图片目标过协议白名单，图片额外要求绝对
// HTTP(S)，raw HTML 以字面文本渲染（不进入 DOM）。Lotion 裁剪：无数学公式、
// 无脚注、无文件提及、无代码高亮；额外支持 [@标题](文档id) 提及胶囊（onOpenDocument）。
//
// 合并可扩展节点联合落入文档化 default（渲染为空），而非 assertNever 结束：
// 别处注册的语法可能产生本渲染器没有映射的节点类型。

import { Fragment, createElement } from "react";
import type { Key, ReactNode } from "react";
import type * as Md from "mdast";
import { normalizeUri } from "micromark-util-sanitize-uri";
import { truncateMentionTitle } from "@/lib/mention";
import { CodeBlock } from "./CodeBlock";
import type { PositionedBlock } from "./incremental";

function sanitizeUrl(url: string): string {
  try {
    switch (new URL(url).protocol) {
      case "http:":
      case "https:":
      case "mailto:":
        return url;
      default:
        return "";
    }
  } catch {
    // 相对路径等无法解析的目标一律拒绝
    return "";
  }
}

function remoteImageUrl(url: string): string | undefined {
  try {
    const protocol = new URL(url).protocol;
    return protocol === "http:" || protocol === "https:" ? url : undefined;
  } catch {
    return undefined;
  }
}

/** 从文档收集的链接/图片引用目标（每个标识符取首个定义，同 CommonMark）。 */
export interface ReferenceTargets {
  /** 链接定义，按大写标识符索引。 */
  definitions: Map<string, Md.Definition>;
}

/** 创建空 {@link ReferenceTargets}。 */
export function createReferenceTargets(): ReferenceTargets {
  return { definitions: new Map() };
}

/** 深度优先把 `nodes` 下所有定义记入 `targets`（每个标识符保留首个）。 */
export function collectReferenceTargets(
  nodes: readonly Md.RootContent[],
  targets: ReferenceTargets,
): void {
  for (const node of nodes) {
    if (node.type === "definition") {
      const id = node.identifier.toUpperCase();
      if (!targets.definitions.has(id)) targets.definitions.set(id, node);
    }
    if ("children" in node) collectReferenceTargets(node.children, targets);
  }
}

/** 一轮渲染的状态：不可变选项与引用目标。 */
export interface MarkdownRenderContext {
  /** 流式臂：围栏代码不高亮（Lotion 无高亮，保持语义一致性）。 */
  readonly streaming: boolean;
  /** 本轮可见的引用目标。 */
  readonly targets: ReferenceTargets;
  /** 锚点内部：提及胶囊不得嵌套交互元素。 */
  readonly inLink?: boolean;
  /** [@标题](文档id) 提及的打开回调；缺省时按普通链接渲染。 */
  readonly onOpenDocument?: (id: string) => void;
}

/**
 * 渲染顶层块。渲染为空的节点（定义等）直接丢弃而非保留 null 占位，
 * 使子列表与分隔换行落位一致。
 * @param blocks - 带流稳定渲染 key 的块。
 * @param context - 本轮渲染状态。
 * @returns 每块一个 React 节点。
 */
export function renderBlocks(
  blocks: readonly PositionedBlock[],
  context: MarkdownRenderContext,
): ReactNode[] {
  return blocks
    .map((block) => renderNode(block.node, block.key, context))
    .filter((element) => element !== null);
}

/** 在块级子元素间插入换行文本节点（不可见，但与相邻字面 raw-HTML 文本合并）。 */
export function wrapBlockChildren(elements: readonly ReactNode[], edges: boolean): ReactNode[] {
  const wrapped: ReactNode[] = [];
  for (const element of elements) {
    if (edges || wrapped.length > 0) wrapped.push("\n");
    wrapped.push(element);
  }
  if (edges && elements.length > 0) wrapped.push("\n");
  return wrapped;
}

/** 容器子元素渲染：区分段落与其他块（列表项 tight 时解包段落）。 */
type BlockEntry = { paragraph: ReactNode[] } | { element: ReactNode };

function renderBlockEntries(
  blocks: readonly Md.RootContent[],
  context: MarkdownRenderContext,
): BlockEntry[] {
  const entries: BlockEntry[] = [];
  for (const [index, block] of blocks.entries()) {
    if (block.type === "paragraph") {
      entries.push({ paragraph: renderChildren(block.children, context) });
    } else {
      const element = renderNode(block, index, context);
      if (element !== null) entries.push({ element });
    }
  }
  return entries;
}

function renderChildren(
  nodes: readonly Md.RootContent[],
  context: MarkdownRenderContext,
): ReactNode[] {
  return nodes.map((node, index) => renderNode(node, index, context));
}

/** 子节点纯文本（mention 检测用）。 */
function childrenToText(children: ReactNode[]): string {
  return children
    .map((child) => (typeof child === "string" ? child : ""))
    .join("");
}

function renderNode(node: Md.RootContent, key: Key, context: MarkdownRenderContext): ReactNode {
  switch (node.type) {
    case "text":
      return node.value;
    case "paragraph":
      return <p key={key}>{renderChildren(node.children, context)}</p>;
    case "heading":
      return createElement(`h${node.depth}`, { key }, ...renderChildren(node.children, context));
    case "blockquote":
      return (
        <blockquote key={key}>
          {wrapBlockChildren(
            renderChildren(node.children, context).filter((child) => child !== null),
            true,
          )}
        </blockquote>
      );
    case "thematicBreak":
      return <hr key={key} />;
    case "break":
      return (
        <Fragment key={key}>
          <br />
          {"\n"}
        </Fragment>
      );
    case "strong":
      return <strong key={key}>{renderChildren(node.children, context)}</strong>;
    case "emphasis":
      return <em key={key}>{renderChildren(node.children, context)}</em>;
    case "delete":
      return <del key={key}>{renderChildren(node.children, context)}</del>;
    case "inlineCode": {
      // 与 mdast-util-to-hast 一致：行内代码中的换行渲染为空格
      const value = node.value.replace(/\r?\n|\r/g, " ");
      // 整段为绝对 HTTP(S) URL 的行内代码保留 code 外观并升级为安全外链
      const href = inlineCodeHttpUrl(value);
      if (href !== undefined) return <code key={key}>{renderSafeLink(href, [value], "link")}</code>;
      return <code key={key}>{value}</code>;
    }
    case "html":
      // 管线中不引入 HTML 解析器：raw HTML 保持字面文本
      return node.value;
    case "code":
      return renderCode(node, key, context);
    case "list":
      return renderList(node, key, context);
    case "listItem":
      return renderListItem(node, listItemLoose(node), key, context);
    case "table":
      return renderTable(node, key, context);
    case "link":
      return renderAnchor(node.url, renderChildren(node.children, { ...context, inLink: true }), key, context);
    case "linkReference":
      return renderLinkReference(node, key, context);
    case "image":
      return renderImage(node.url, node.alt ?? "", key);
    case "imageReference":
      return renderImageReference(node, key, context);
    case "definition":
    case "footnoteDefinition":
    case "footnoteReference":
      // 目标/未映射节点在别处处理或渲染为空
      return null;
    default:
      // 合并可扩展联合的兜底：无映射的节点类型渲染为空
      return null;
  }
}

function renderCode(node: Md.Code, key: Key, context: MarkdownRenderContext): ReactNode {
  const language = node.lang ?? undefined;
  if (node.value === "") {
    // 空围栏渲染为普通 <pre>
    return (
      <pre key={key}>
        <code className={language === undefined ? undefined : `language-${language}`} />
      </pre>
    );
  }
  // 语法 id 从 info string 取首个 \w 段（对齐 DSH 的 hast 类名恢复）
  const lang = language === undefined ? undefined : /^[\w-]+/.exec(language)?.[0];
  return (
    <CodeBlock
      key={key}
      code={`${node.value}\n`}
      lang={context.streaming ? undefined : lang}
    />
  );
}

/** 列表 loose 当且仅当它或任一子项 spread；此时每项保留段落。 */
function listLoose(list: Md.List): boolean {
  return (list.spread ?? false) || list.children.some(listItemLoose);
}

function listItemLoose(item: Md.ListItem): boolean {
  return item.spread ?? item.children.length > 1;
}

function renderList(node: Md.List, key: Key, context: MarkdownRenderContext): ReactNode {
  const loose = listLoose(node);
  const properties: { start?: number; className?: string } = {};
  if (typeof node.start === "number" && node.start !== 1) properties.start = node.start;
  if (node.children.some((item) => typeof item.checked === "boolean")) {
    properties.className = "contains-task-list";
  }
  return createElement(
    node.ordered === true ? "ol" : "ul",
    { key, ...properties },
    ...node.children.map((item, index) => renderListItem(item, loose, index, context)),
  );
}

function renderListItem(
  item: Md.ListItem,
  loose: boolean,
  key: Key,
  context: MarkdownRenderContext,
): ReactNode {
  const entries = renderBlockEntries(item.children, context);
  const task = typeof item.checked === "boolean";
  if (task) {
    const checkbox = <input key="task-checkbox" type="checkbox" checked={item.checked === true} disabled />;
    const head = entries[0];
    if (head !== undefined && "paragraph" in head) {
      head.paragraph = head.paragraph.length > 0 ? [checkbox, " ", ...head.paragraph] : [checkbox];
    } else {
      entries.unshift({ paragraph: [checkbox] });
    }
  }
  // 换行放置与 tight 段落解包对齐 mdast-util-to-hast 的 list-item handler
  const parts: ReactNode[] = [];
  for (const [index, entry] of entries.entries()) {
    const isParagraph = "paragraph" in entry;
    if (loose || index !== 0 || !isParagraph) parts.push("\n");
    if (!isParagraph) parts.push(entry.element);
    else if (loose) parts.push(<p key={`p-${index}`}>{entry.paragraph}</p>);
    else parts.push(<Fragment key={`p-${index}`}>{entry.paragraph}</Fragment>);
  }
  const tail = entries[entries.length - 1];
  if (tail !== undefined && (loose || !("paragraph" in tail))) parts.push("\n");
  return (
    <li key={key} className={task ? "task-list-item" : undefined}>
      {parts}
    </li>
  );
}

function renderTable(node: Md.Table, key: Key, context: MarkdownRenderContext): ReactNode {
  const align = node.align ?? null;
  const [headRow, ...bodyRows] = node.children;
  return (
    <div key={key} className="md-table-scroll">
      <table>
        {headRow !== undefined && <thead>{renderTableRow(headRow, "th", align, 0, context)}</thead>}
        {bodyRows.length > 0 && (
          <tbody>
            {bodyRows.map((row, index) => renderTableRow(row, "td", align, index + 1, context))}
          </tbody>
        )}
      </table>
    </div>
  );
}

function renderTableRow(
  row: Md.TableRow,
  cellTag: "th" | "td",
  align: readonly Md.AlignType[] | null,
  key: Key,
  context: MarkdownRenderContext,
): ReactNode {
  // 有列对齐信息时每行渲染每列恰好一个单元格，补齐或截断（mdast-util-to-hast 对齐）
  const length = align === null ? row.children.length : align.length;
  const cells: ReactNode[] = [];
  for (let index = 0; index < length; index++) {
    const cell = row.children[index];
    const alignValue = align?.[index];
    cells.push(
      createElement(
        cellTag,
        // 与 hast-util-to-jsx-runtime 默认行为一致：align 以行内样式呈现
        { key: index, style: alignValue == null ? undefined : { textAlign: alignValue } },
        ...(cell === undefined ? [] : renderChildren(cell.children, context)),
      ),
    );
  }
  return <tr key={key}>{cells}</tr>;
}

/** 已授权 href 上的锚点：白名单之外不包链接，外链加安全属性。 */
function renderSafeLink(href: string, children: ReactNode[], key: Key): ReactNode {
  const safeHref = sanitizeUrl(href);
  if (safeHref === "") return <Fragment key={key}>{children}</Fragment>;
  const external = ["http:", "https:"].includes(new URL(safeHref).protocol);
  return (
    <a
      key={key}
      href={safeHref}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
    >
      {children}
    </a>
  );
}

/**
 * 解析后的 markdown 目标上的锚点（hast 先归一化，白名单后见）。
 * [@标题](文档id) 提及：url 为文档 id 且文本以 @ 开头 → 渲染为打开文档的胶囊。
 */
function renderAnchor(
  url: string,
  children: ReactNode[],
  key: Key,
  context: MarkdownRenderContext,
): ReactNode {
  const open = context.onOpenDocument;
  if (open !== undefined && /^[a-zA-Z0-9-]{3,64}$/.test(url)) {
    const text = childrenToText(children);
    if (text.startsWith("@")) {
      return (
        <button
          key={key}
          type="button"
          title={url}
          onClick={() => open(url)}
          className="mention-chip cursor-pointer"
        >
          <span>{"@" + truncateMentionTitle(text.slice(1))}</span>
        </button>
      );
    }
  }
  return renderSafeLink(normalizeUri(url), children, key);
}

function renderLinkReference(node: Md.LinkReference, key: Key, context: MarkdownRenderContext): ReactNode {
  const definition = context.targets.definitions.get(node.identifier.toUpperCase());
  if (definition === undefined) return null;
  return renderAnchor(definition.url, renderChildren(node.children, { ...context, inLink: true }), key, context);
}

/** 行内代码值恰为绝对 HTTP(S) URL（无周边空白）时返回它；其余保持惰性代码。 */
function inlineCodeHttpUrl(value: string): string | undefined {
  if (value.trim() !== value) return undefined;
  try {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:" ? value : undefined;
  } catch {
    return undefined;
  }
}

function renderImage(url: string, alt: string, key: Key): ReactNode {
  const imageSrc = remoteImageUrl(sanitizeUrl(normalizeUri(url)));
  if (imageSrc === undefined) {
    return (
      <span key={key} className="md-image-alt">
        {alt}
      </span>
    );
  }
  return <img key={key} className="md-image" src={imageSrc} alt={alt} />;
}

function renderImageReference(node: Md.ImageReference, key: Key, context: MarkdownRenderContext): ReactNode {
  const definition = context.targets.definitions.get(node.identifier.toUpperCase());
  if (definition === undefined) return null;
  return renderImage(definition.url, node.alt ?? "", key);
}
