"use client";

// 围栏代码块：语言横幅 + 复制按钮 + 语法高亮（懒加载 shiki，双主题）。
//
// 与编辑器共用同一份语言白名单（lib/highlight-langs.ts）：未列出的语言按纯文本展示。
// 高亮是**异步**的：首帧先出原文（文字立刻可读、可复制），token 到达后再上色。
// 流式期间 render.tsx 不传 lang（半截代码高亮出来会闪），定稿后才开始高亮。

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { highlightFence } from "@/lib/markdown-highlight";
import type { HighlightedLines } from "@/lib/markdown-highlight";

export interface CodeBlockProps {
  /** 源码文本，展示时裁剪末尾换行。 */
  code: string;
  /** 语法提示（围栏 info string）；未知/缺省 = 纯文本。 */
  lang?: string | undefined;
}

export function CodeBlock({ code, lang }: CodeBlockProps) {
  const trimmed = code.endsWith("\n") ? code.slice(0, -1) : code;
  const rootRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);

  // 高亮结果（null = 纯文本：加载中 / 语言不支持 / 失败都落这里）
  const [lines, setLines] = useState<HighlightedLines | null>(null);
  useEffect(() => {
    let cancelled = false;
    setLines(null);
    void highlightFence(trimmed, lang).then((result) => {
      // 代码或语言已变（流式追加、同一位置换了块）时丢弃过期结果
      if (!cancelled) setLines(result);
    });
    return () => {
      cancelled = true;
    };
  }, [trimmed, lang]);

  const onCopy = useCallback(() => {
    if (copied) return;
    const text = rootRef.current?.querySelector("pre")?.textContent ?? trimmed;
    const done = () => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1000);
    };
    // navigator.clipboard 需安全上下文；失败时回退 execCommand（老式兼容）
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => done());
    } else {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
      } catch {
        /* 复制失败静默 */
      }
      document.body.removeChild(ta);
      done();
    }
  }, [copied, trimmed]);

  // 渲染内容：纯文本与高亮 token 两条臂。
  // 行与行之间用 "\n" 文本节点分隔（而不是每行包一个块级元素）：pre 的软换行、
  // textContent 复制与横向滚动行为都与纯文本完全一致。
  const content =
    lines === null
      ? trimmed
      : lines.map((line, lineIndex) => (
          <Fragment key={lineIndex}>
            {lineIndex > 0 ? "\n" : null}
            {line.map((token, tokenIndex) => (
              <span
                key={tokenIndex}
                // 双主题：只写 --shiki-light / --shiki-dark 变量，颜色由 CSS 按 .dark 切换
                style={token.htmlStyle as CSSProperties | undefined}
              >
                {token.content}
              </span>
            ))}
          </Fragment>
        ));

  return (
    <div ref={rootRef} className="md-code-block" data-highlighted={lines !== null}>
      <div className="md-code-banner">
        <span className="md-code-lang">{lang ?? ""}</span>
        <button type="button" className="md-code-copy" onClick={onCopy}>
          {copied ? "已复制" : "复制"}
        </button>
      </div>
      <pre>
        <code>{content}</code>
      </pre>
    </div>
  );
}
