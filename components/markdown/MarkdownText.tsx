"use client";

// 对齐 DSH（deepseek-harness ui-primitives MarkdownText.tsx）：
// 不可信 assistant Markdown 渲染器，直连 mdast 管线（parse.ts 语法 + 增量流式
// 解析器 + render.tsx）。消息流式期间除末尾两块外的全部块冻结为缓存的 React
// 元素，每个 chunk 只重解析其后的源尾部，单块工作量随尾部而非全文增长；
// 冻结块跨冻结边界保持源偏移 key，React 协调而非重挂载。
// 已知流式偏差（与 DSH 相同）：定义位于冻结边界另一侧的引用式链接会按字面
// 渲染，直到 settled 全量解析自愈。

import { memo, useMemo, useRef } from "react";
import type { ReactNode } from "react";
import { IncrementalMarkdownParser } from "./incremental";
import { parseGfm } from "./parse";
import {
  collectReferenceTargets,
  createReferenceTargets,
  renderBlocks,
  wrapBlockChildren,
  type MarkdownRenderContext,
} from "./render";

/** 一次定稿全量渲染：解析、解析引用、渲染全部块。 */
function renderSettled(text: string, onOpenDocument: ((id: string) => void) | undefined): ReactNode[] {
  const root = parseGfm(text);
  const targets = createReferenceTargets();
  collectReferenceTargets(root.children, targets);
  const context: MarkdownRenderContext = { streaming: false, targets, onOpenDocument };
  return wrapBlockChildren(
    renderBlocks(
      root.children.map((node, index) => ({ node, key: index })),
      context,
    ),
    false,
  );
}

/** 一篇增长中消息的流式渲染状态：增量解析器 + 冻结块缓存元素。 */
class StreamingRenderer {
  private readonly parser = new IncrementalMarkdownParser(parseGfm);
  private generation = -1;
  private frozenCount = 0;
  private frozenElements: ReactNode[] = [];
  private frozenTargets = createReferenceTargets();
  private lastText: string | null = null;
  private lastRendered: ReactNode[] = [];

  /**
   * 渲染当前累积文本。对相同文本幂等，React 可自由重执行调用方渲染。
   * @param text - 完整累积的 markdown 源。
   * @returns 冻结元素 + 重渲染尾部。
   */
  render(text: string, onOpenDocument: ((id: string) => void) | undefined): ReactNode[] {
    if (text === this.lastText) return this.lastRendered;
    const { frozen, tail, generation } = this.parser.update(text);
    if (generation !== this.generation) {
      this.generation = generation;
      this.frozenCount = 0;
      this.frozenElements = [];
      this.frozenTargets = createReferenceTargets();
    }
    const newlyFrozen = frozen.slice(this.frozenCount);
    collectReferenceTargets(
      newlyFrozen.map((block) => block.node),
      this.frozenTargets,
    );
    // 本帧可见的目标：已冻结全部 + 当前尾部解析
    const frameTargets = {
      definitions: new Map(this.frozenTargets.definitions),
    };
    collectReferenceTargets(
      tail.map((block) => block.node),
      frameTargets,
    );
    if (newlyFrozen.length > 0) {
      const frozenContext: MarkdownRenderContext = {
        streaming: true,
        targets: frameTargets,
        onOpenDocument,
      };
      const batch = [...this.frozenElements];
      for (const element of renderBlocks(newlyFrozen, frozenContext)) {
        if (batch.length > 0) batch.push("\n");
        batch.push(element);
      }
      this.frozenElements = batch;
      this.frozenCount = frozen.length;
    }
    const tailContext: MarkdownRenderContext = { streaming: true, targets: frameTargets, onOpenDocument };
    const children = [...this.frozenElements];
    for (const element of renderBlocks(tail, tailContext)) {
      if (children.length > 0) children.push("\n");
      children.push(element);
    }
    this.lastText = text;
    this.lastRendered = children;
    return this.lastRendered;
  }
}

/**
 * 把不可信的 assistant Markdown 渲染为语义化 React 元素（GFM 表格/删除线/任务
 * 列表 + CJK 友好加粗）。流式时增量解析；`streaming` 结束后的重渲染自动转为
 * 定稿全量解析。raw HTML、相对链接与不安全协议被禁用；绝对 HTTP(S) 图片直渲；
 * [@标题](文档id) 经 `onOpenDocument` 渲染为打开文档的提及胶囊。
 */
export const MarkdownText = memo(function MarkdownText({
  text,
  streaming = false,
  onOpenDocument,
}: {
  text: string;
  streaming?: boolean;
  onOpenDocument?: (id: string) => void;
}) {
  const streamRef = useRef<StreamingRenderer | null>(null);
  // 回调引用经 ref 透传：父组件每次渲染可能新建函数，不因此丢弃流式缓存
  const openRef = useRef(onOpenDocument);
  openRef.current = onOpenDocument;
  const children = useMemo(() => {
    if (!streaming) {
      streamRef.current = null;
      return renderSettled(text, openRef.current);
    }
    if (streamRef.current === null) {
      streamRef.current = new StreamingRenderer();
    }
    return streamRef.current.render(text, openRef.current);
  }, [text, streaming]);
  return <div className="md-content">{children}</div>;
});
