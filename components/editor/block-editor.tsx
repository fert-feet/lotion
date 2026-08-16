"use client";

// 自研块编辑器（阶段 2b，对齐 SiYuan protyle 块模型 + DSH 渲染管线）：
// - 文档模型：Markdown 原文（阶段 1），解析为可编辑块序列（lib/editor/blocks.ts）
// - 渲染：复用 markdown 渲染器（renderNode）——非编辑块静态渲染（包一层可点击
//   进入编辑的块壳），编辑块为 contentEditable（初始 HTML 由 inline mdast 渲染，
//   提交时 DOM → Markdown 序列化）
// - 编辑操作：纯函数 ops（Enter 分块 / Backspace 合并删除 / ↑↓ 跨块 / todo 勾选），
//   只重写受影响块的源切片，其余原文原样保留
// - AI 同步：initialContent 变化（非编辑中）时整体替换
//
// MVP 边界：列表嵌套缩进（Tab）、拖拽、粘贴富文本/图片、斜杠菜单留待后续阶段。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Key, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { RootContent } from "mdast";
import { parseGfm } from "@/components/markdown/parse";
import {
  createReferenceTargets,
  renderInlineChildren,
  renderListItemContent,
  renderNode,
  type MarkdownRenderContext,
} from "@/components/markdown/render";
import { toMarkdown } from "@/lib/content";
import { parseEditableBlocks, type EditableBlock } from "@/lib/editor/blocks";
import { cloneRootWithoutAnchors } from "@/lib/editor/anchors";
import { serializeEditable } from "@/lib/editor/dom-to-markdown";
import { deleteBlock, mergeIntoPrevious, replaceBlockText, splitBlock, toggleTodo } from "@/lib/editor/ops";

interface BlockEditorProps {
  onChange: (markdown: string) => void;
  initialContent?: string;
  editable?: boolean;
}

/** 最小渲染上下文（非编辑块静态渲染） */
const STATIC_CONTEXT: MarkdownRenderContext = {
  streaming: false,
  targets: createReferenceTargets(),
};

/** 块内 inline children（列表项/引用取首个段落） */
function inlineChildrenOf(node: RootContent): readonly RootContent[] {
  if ("children" in node && Array.isArray(node.children)) {
    const first = node.children[0];
    if (first && first.type === "paragraph" && "children" in first) {
      return first.children as readonly RootContent[];
    }
    return node.children as readonly RootContent[];
  }
  return [];
}

/** contentEditable 内光标距文本起点的字符偏移 */
function caretOffset(el: HTMLElement): number {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return (el.textContent ?? "").length;
  const range = sel.getRangeAt(0);
  const pre = range.cloneRange();
  pre.selectNodeContents(el);
  pre.setEnd(range.startContainer, range.startOffset);
  return pre.toString().length;
}

/** 光标定位：把 selection 放到文本偏移处 */
function setCaret(el: HTMLElement, offset: number) {
  const sel = window.getSelection();
  if (!sel) return;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let remaining = offset;
  let node: Node | null = walker.nextNode();
  let target: { node: Node; offset: number } = { node: el, offset: 0 };
  while (node) {
    const len = node.textContent?.length ?? 0;
    if (remaining <= len) {
      target = { node, offset: remaining };
      break;
    }
    remaining -= len;
    node = walker.nextNode();
  }
  if (!node) target = { node: el, offset: (el.textContent ?? "").length };
  const range = document.createRange();
  range.setStart(target.node, target.offset);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

// ---- 编辑块视图（顶层组件，回调经 props 注入） ----

interface EditViewProps {
  block: EditableBlock;
  index: number;
  editable: boolean;
  initialHtml: string;
  /** 键盘变换：Enter → ("", before, after)；Backspace 空块 → ("DELETE", "", "")；
   *  Backspace 非空 → ("MERGE", "", "")；↑ → ("UP", "", "")；↓ → ("DOWN", "", "") */
  onTransform: (index: number, before: string, after: string) => void;
  /** 失焦提交 */
  onBlurCommit: (index: number, text: string, initialText: string) => void;
}

/** 行文本块编辑视图（contentEditable） */
function EditableTextView({ block, index, editable, initialHtml, onTransform, onBlurCommit }: EditViewProps) {
  const ref = useRef<HTMLDivElement>(null);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!editable) return;
    const el = ref.current;
    if (!el) return;
    const text = serializeEditable(el);
    const offset = caretOffset(el);

    // Enter（非 Shift）：光标处分块，新块同类型
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      onTransform(index, text.slice(0, offset), text.slice(offset));
      return;
    }
    // Backspace：块首 → 空块删除 / 非空与前块合并
    if (e.key === "Backspace" && offset === 0) {
      e.preventDefault();
      onTransform(index, text === "" ? "DELETE" : "MERGE", "");
      return;
    }
    // ↑/↓ 跨块移动（块首 ↑ / 块尾 ↓）
    if (e.key === "ArrowUp" && offset === 0) {
      e.preventDefault();
      onTransform(index, "UP", "");
      return;
    }
    if (e.key === "ArrowDown" && offset >= text.length) {
      e.preventDefault();
      onTransform(index, "DOWN", "");
      return;
    }
  };

  return (
    <div
      ref={ref}
      contentEditable={editable}
      suppressContentEditableWarning
      data-block-kind={block.kind}
      data-editing-key={index}
      className="md-editable-block"
      onKeyDown={onKeyDown}
      onBlur={() => {
        const el = ref.current;
        onBlurCommit(index, el ? serializeEditable(el) : block.text, block.text);
      }}
      dangerouslySetInnerHTML={{ __html: initialHtml }}
    />
  );
}

interface CodeEditViewProps {
  block: EditableBlock;
  index: number;
  editable: boolean;
  /** 提交当前值（跨块移动/失焦） */
  onCommit: (index: number, text: string) => void;
  /** 跨块导航：direction 为 -1（↑ 前块）/ +1（↓ 后块） */
  onNav: (index: number, direction: -1 | 1) => void;
  onBlurDone: () => void;
}

/** code 块编辑视图（textarea，Enter 换行天然支持） */
function CodeEditView({ block, index, editable, onCommit, onNav, onBlurDone }: CodeEditViewProps) {
  const [value, setValue] = useState(block.text);
  const ref = useRef<HTMLTextAreaElement>(null);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (!editable) return;
    const el = ref.current;
    if (!el) return;
    const offset = el.selectionStart ?? 0;
    // 首行 ↑ / 末行 ↓ 跨块移动（先提交当前值）
    if (e.key === "ArrowUp" && offset === 0) {
      e.preventDefault();
      onCommit(index, value);
      onNav(index, -1);
    }
    if (e.key === "ArrowDown" && offset >= value.length) {
      e.preventDefault();
      onCommit(index, value);
      onNav(index, 1);
    }
  };

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={onKeyDown}
      onBlur={() => {
        if (editable) onCommit(index, value);
        onBlurDone();
      }}
      spellCheck={false}
      className="md-editable-code"
    />
  );
}

// ---- 编辑器主体 ----

export default function BlockEditor({ onChange, initialContent, editable = true }: BlockEditorProps) {
  // ---- 文档源（内部状态；initialContent 变化且非编辑中时同步） ----
  const [markdown, setMarkdown] = useState(() => toMarkdown(initialContent));
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const lastApplied = useRef<string | undefined>(initialContent);
  const editingRef = useRef<number | null>(null);
  editingRef.current = editingIndex;
  const markdownRef = useRef(markdown);
  markdownRef.current = markdown;

  const root = useMemo(() => parseGfm(markdown), [markdown]);
  // 展示树：剥离块锚点 {#id}（定位/切片仍用原始 root，渲染/编辑内容不见锚点）
  const displayRoot = useMemo(() => cloneRootWithoutAnchors(root), [root]);
  const blocks = useMemo(() => parseEditableBlocks(markdown), [markdown]);
  const blocksRef = useRef(blocks);
  blocksRef.current = blocks;

  // mdast 节点按 start 偏移索引（编辑块的 inline children 来源，已剥离锚点）
  const nodeByStart = useMemo(() => {
    const map = new Map<number, RootContent>();
    const walk = (nodes: readonly RootContent[]) => {
      for (const n of nodes) {
        const p = n.position?.start.offset;
        if (typeof p === "number") map.set(p, n);
        if ("children" in n && Array.isArray(n.children)) {
          walk(n.children as readonly RootContent[]);
        }
      }
    };
    walk(displayRoot.children);
    return map;
  }, [displayRoot]);

  // start 偏移 → 可编辑块索引
  const indexByStart = useMemo(() => {
    const map = new Map<number, number>();
    blocks.forEach((b, i) => map.set(b.start, i));
    return map;
  }, [blocks]);

  // AI 修改文档后 initialContent 变化：非编辑中时整体替换（编辑中忽略，用户优先）
  useEffect(() => {
    if (!initialContent || lastApplied.current === initialContent) return;
    if (editingRef.current !== null) return;
    lastApplied.current = initialContent;
    setMarkdown(toMarkdown(initialContent));
  }, [initialContent]);

  /** 提交编辑结果到文档源（替换块切片 + 通知父组件） */
  const commitEdit = useCallback(
    (index: number, newText: string) => {
      const result = replaceBlockText(markdownRef.current, index, newText);
      markdownRef.current = result.markdown;
      setMarkdown(result.markdown);
      onChange(result.markdown);
    },
    [onChange],
  );

  /** 应用编辑操作结果（分块/合并/删除/toggle） */
  const applyResult = useCallback(
    (result: { markdown: string }) => {
      markdownRef.current = result.markdown;
      setMarkdown(result.markdown);
      onChange(result.markdown);
    },
    [onChange],
  );

  // 焦点位置提示：Enter 分块 → 新块开头；↑↓ 跨块 → 相邻块末尾/开头
  const focusPosRef = useRef<"start" | "end">("end");

  // 编辑块挂载后聚焦
  useEffect(() => {
    if (editingIndex === null) return;
    const el = document.querySelector<HTMLElement>(`[data-editing-key="${editingIndex}"]`);
    if (!el) return;
    if (el.tagName === "TEXTAREA") {
      (el as HTMLTextAreaElement).focus();
      return;
    }
    el.focus();
    if (focusPosRef.current === "start") {
      setCaret(el, 0);
    } else {
      setCaret(el, (el.textContent ?? "").length);
    }
    focusPosRef.current = "end";
  }, [editingIndex]);

  /** 键盘变换分发（Enter 分块 / Backspace 删除合并 / ↑↓ 导航） */
  const handleTransform = useCallback(
    (index: number, before: string, after: string) => {
      const block = blocksRef.current[index];
      if (!block) return;

      if (before === "UP") {
        // ↑：块首 → 前块末尾
        if (index > 0) {
          focusPosRef.current = "end";
          setEditingIndex(index - 1);
        }
        return;
      }
      if (before === "DOWN") {
        // ↓：块尾 → 后块开头
        if (index < blocksRef.current.length - 1) {
          focusPosRef.current = "start";
          setEditingIndex(index + 1);
        }
        return;
      }
      if (before === "DELETE" || before === "MERGE") {
        // Backspace：空块删除自身 / 非空与前块合并
        const result =
          before === "DELETE"
            ? deleteBlock(markdownRef.current, index)
            : mergeIntoPrevious(markdownRef.current, index);
        applyResult(result);
        focusPosRef.current = "end";
        setEditingIndex(Math.max(0, index - 1));
        return;
      }

      // Enter 分块：光标处分块，新块同类型
      const result = splitBlock(markdownRef.current, index, before, after);
      applyResult(result);
      focusPosRef.current = "start";
      setEditingIndex(index + 1);
    },
    [applyResult],
  );

  /** 失焦提交（文本变化才提交） */
  const handleBlurCommit = useCallback(
    (index: number, text: string, initialText: string) => {
      setEditingIndex(null);
      if (editable && text !== initialText) {
        commitEdit(index, text);
      }
    },
    [commitEdit, editable],
  );

  const rootRef = useRef(displayRoot);
  rootRef.current = displayRoot;
  const indexByStartRef = useRef(indexByStart);
  indexByStartRef.current = indexByStart;
  const nodeByStartRef = useRef(nodeByStart);
  nodeByStartRef.current = nodeByStart;

  // 点击块 → 进入编辑
  const handleBlockClick = useCallback(
    (e: ReactMouseEvent) => {
      if (!editable) return;
      const target = e.target as HTMLElement;
      const shell = target.closest("[data-block-index]") as HTMLElement | null;
      if (!shell) return;
      const idx = Number(shell.dataset.blockIndex);
      const block = blocksRef.current[idx];
      if (!block) return;
      if (block.kind === "divider" || block.kind === "table") return;
      focusPosRef.current = "end";
      setEditingIndex(idx);
    },
    [editable],
  );

  // 尾部空白点击区：聚焦末尾块
  const blankClick = useCallback(
    (e: ReactMouseEvent) => {
      if (!editable) return;
      e.preventDefault();
      const last = Math.max(0, blocksRef.current.length - 1);
      focusPosRef.current = "end";
      setEditingIndex(last);
    },
    [editable],
  );

  // ---- 树渲染：非编辑块静态渲染（可点击块壳），编辑块替换为可编辑视图 ----
  const renderTree = useCallback((): ReactNode[] => {
    const editingNow = editingRef.current;
    const renderStaticShell = (node: RootContent, index: number, key: Key): ReactNode => {
      return (
        <div
          key={key}
          data-block-index={index}
          className="md-block-shell"
          onClick={handleBlockClick}
        >
          {renderNode(node, key, STATIC_CONTEXT)}
        </div>
      );
    };

    return rootRef.current.children.map((node, i) => {
      const start = node.position?.start.offset ?? -1;
      const isEditing = editingNow !== null && blocksRef.current[editingNow]?.start === start;

      if (isEditing) {
        const block = blocksRef.current[editingNow!];
        const key = editingNow!;
        const mdNode = nodeByStartRef.current.get(block.start);
        const initialHtml = mdNode
          ? renderToStaticMarkup(<>{renderInlineChildren(inlineChildrenOf(mdNode))}</>)
          : renderToStaticMarkup(<>{block.text}</>);
        if (block.kind === "code") {
          return (
            <CodeEditView
              key={key}
              block={block}
              index={key}
              editable={editable}
              onCommit={commitEdit}
              onNav={(idx, dir) => {
                focusPosRef.current = dir === -1 ? "end" : "start";
                setEditingIndex(idx + dir);
              }}
              onBlurDone={() => setEditingIndex(null)}
            />
          );
        }
        return (
          <EditableTextView
            key={key}
            block={block}
            index={key}
            editable={editable}
            initialHtml={initialHtml}
            onTransform={handleTransform}
            onBlurCommit={handleBlurCommit}
          />
        );
      }

      // 列表容器：item 级编辑替换
      if (node.type === "list") {
        return (
          <ul
            key={i}
            {...(node.children.some((it) => typeof it.checked === "boolean")
              ? { className: "contains-task-list" }
              : {})}
          >
            {node.children.map((item) => {
              const itemStart = item.position?.start.offset ?? -1;
              const itemEditing =
                editingNow !== null && blocksRef.current[editingNow]?.start === itemStart;
              if (itemEditing) {
                const block = blocksRef.current[editingNow!];
                const key = editingNow!;
                const mdNode = nodeByStartRef.current.get(block.start);
                const initialHtml = mdNode
                  ? renderToStaticMarkup(<>{renderInlineChildren(inlineChildrenOf(mdNode))}</>)
                  : renderToStaticMarkup(<>{block.text}</>);
                return (
                  <li key={key} className="task-list-item">
                    {block.kind === "todo" && (
                      <span
                        className="md-todo-check"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          const r = toggleTodo(markdownRef.current, key);
                          applyResult(r);
                        }}
                      >
                        <input type="checkbox" checked={block.meta.checked === true} readOnly />
                      </span>
                    )}
                    <EditableTextView
                      block={block}
                      index={key}
                      editable={editable}
                      initialHtml={initialHtml}
                      onTransform={handleTransform}
                      onBlurCommit={handleBlurCommit}
                    />
                  </li>
                );
              }
              const itemIndex = indexByStartRef.current.get(itemStart) ?? i;
              // 非编辑项：renderListItemContent 渲染 li 内容（不含外层 <li>），
              // 组件层包 <li><div 块壳>，避免 renderNode(listItem) 输出 <li> 造成
              // <li> 嵌套 <li> 的非法 DOM（嵌套子列表由 render.tsx 内部合法渲染）
              const loose =
                (node.spread ?? false) || node.children.some((it) => it.spread ?? it.children.length > 1);
              const { task, parts } = renderListItemContent(item, loose, STATIC_CONTEXT);
              return (
                <li key={itemStart} className={task ? "task-list-item" : undefined}>
                  <div
                    data-block-index={itemIndex}
                    className="md-block-shell"
                    onClick={handleBlockClick}
                  >
                    {parts}
                  </div>
                </li>
              );
            })}
          </ul>
        );
      }

      const blockIndex = indexByStartRef.current.get(start) ?? i;
      return renderStaticShell(node, blockIndex, start);
    });
  }, [CodeEditView, EditableTextView, applyResult, commitEdit, editable, handleBlurCommit, handleBlockClick, handleTransform]);

  return (
    <div className="md-content md-editor">
      {renderTree()}
      {editable && (
        <div className="md-editor-blank" style={{ minHeight: "40vh" }} onMouseDown={blankClick} />
      )}
    </div>
  );
}
