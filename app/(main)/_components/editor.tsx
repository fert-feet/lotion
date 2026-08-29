"use client";

// 编辑器入口（重构阶段 A）：BlockNote 0.54 替换自研块编辑器。
// - 文档模型：BlockNote JSON 无损存储（阶段 B 统一规范格式；存量 Markdown 经
//   tryParseMarkdownToBlocks 惰性转换，旧 BlockNote JSON 直接解析）
// - 渲染：@blocknote/react 默认 UI + 自有 DSH 对齐样式（components/editor/blocknote.css）
// - 图片上传：uploadFile → POST /api/upload（本地磁盘，见 route.ts 图床 TODO）
// - AI 外部更新：initialContent 变化（AI 写库 / 切换文档）且用户未在编辑时，
//   事务性 replaceBlocks 应用，不打断用户输入
import { useCallback, useEffect, useRef, useState } from "react";
// 0.54 起 @blocknote/react 的默认 UI 视图命名为 BlockNoteViewRaw（默认 UI 标志作 props）
import { BlockNoteViewRaw as BlockNoteView, useCreateBlockNote } from "@blocknote/react";
import type { PartialBlock } from "@blocknote/core";
import "@blocknote/core/style.css";
import "@blocknote/react/style.css";
import { useTheme } from "next-themes";
import { isBlockNoteJson, toEditorBlocks } from "@/lib/content";
import "@/components/editor/blocknote.css";

interface EditorProps {
  onChange: (value: string) => void;
  initialContent?: string;
  editable?: boolean;
}

const Editor = ({ onChange, initialContent, editable = true }: EditorProps) => {
  const { resolvedTheme } = useTheme();

  // 本地版图片上传：POST /api/upload（本地磁盘存储，见 app/api/upload/route.ts 的图床 TODO）
  const handleUpload = useCallback(async (file: File) => {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/upload", { method: "POST", body: form });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "上传失败");
    return data.url as string;
  }, []);

  // 首次挂载时的初始内容：BlockNote JSON 直接解析；Markdown（旧数据）返回 undefined，
  // 由下方 mount 效应在编辑器就绪后 tryParseMarkdownToBlocks 填充。
  // 惰性初始化（仅挂载时计算一次）：后续文档切换 / AI 更新走外部更新效应，编辑器实例不重建。
  // 旧 BlockNote JSON 结构（type/props/content/children）与 0.54 兼容，直接透传
  const [initialBlocks] = useState(
    () => toEditorBlocks(initialContent) as unknown as PartialBlock[] | undefined,
  );
  const editor = useCreateBlockNote(
    {
      initialContent: initialBlocks,
      uploadFile: handleUpload,
    },
    [],
  );

  // 初次挂载：存量 Markdown 文档 → blocks（仅当编辑器仍为空时替换，避免覆盖用户输入）
  useEffect(() => {
    if (!initialContent || isBlockNoteJson(initialContent)) return;
    let alive = true;
    void (async () => {
      const blocks = await editor.tryParseMarkdownToBlocks(initialContent);
      if (!alive) return;
      const doc = editor.document;
      const isEmpty =
        doc.length === 0 ||
        (doc.length === 1 &&
          doc[0].type === "paragraph" &&
          (!doc[0].content || (doc[0].content as unknown[]).length === 0));
      if (isEmpty) {
        editor.replaceBlocks(doc, blocks);
      }
    })();
    return () => {
      alive = false;
    };
    // 仅在挂载时执行一次（切换文档由外部更新效应处理）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // AI 修改文档 / 切换文档：initialContent 变化且用户未在编辑时事务性应用。
  // 用户焦点在编辑器内时跳过（用户优先，与自研编辑器阶段语义一致）。
  const lastApplied = useRef<string | undefined>(initialContent);
  useEffect(() => {
    if (!initialContent || lastApplied.current === initialContent) return;
    lastApplied.current = initialContent;
    if (editor.isFocused()) return;
    let alive = true;
    void (async () => {
      const blocks = isBlockNoteJson(initialContent)
        ? (JSON.parse(initialContent) as PartialBlock[])
        : await editor.tryParseMarkdownToBlocks(initialContent);
      if (!alive) return;
      editor.transact(() => {
        editor.replaceBlocks(editor.document, blocks);
      });
    })();
    return () => {
      alive = false;
    };
  }, [initialContent, editor]);

  const onEditorChange = useCallback(
    (e: typeof editor) => {
      // 规范存储格式为 BlockNote JSON（无损，保留块 ID）
      onChange(JSON.stringify(e.document));
    },
    [onChange],
  );

  return (
    <BlockNoteView
      editor={editor}
      onChange={onEditorChange}
      editable={editable}
      theme={resolvedTheme === "dark" ? "dark" : "light"}
      className="lotion-editor"
    />
  );
};

export default Editor;
