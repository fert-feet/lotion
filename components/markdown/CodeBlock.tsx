"use client";

// 对齐 DSH（deepseek-harness ui-primitives CodeBlock.tsx）的围栏代码块：
// 语言横幅 + 复制按钮。Lotion 不引入 shiki 高亮——代码按等宽字体原样展示
// （DSH 的高亮落地发生在 settled 渲染；此处两臂同为纯文本，行为一致）。

import { useCallback, useRef, useState } from "react";

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

  return (
    <div ref={rootRef} className="md-code-block">
      <div className="md-code-banner">
        <span className="md-code-lang">{lang ?? ""}</span>
        <button type="button" className="md-code-copy" onClick={onCopy}>
          {copied ? "已复制" : "复制"}
        </button>
      </div>
      <pre>
        <code>{trimmed}</code>
      </pre>
    </div>
  );
}
