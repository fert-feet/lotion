"use client";

// 编辑器入口（重构阶段 A）：BlockNote 0.54 替换自研块编辑器。
// - 文档模型：BlockNote JSON 无损存储（阶段 B 统一规范格式；存量 Markdown 经
//   tryParseMarkdownToBlocks 惰性转换，旧 BlockNote JSON 直接解析）
// - 渲染：@blocknote/react 默认 UI + 自有 DSH 对齐样式（components/editor/blocknote.css）
// - 图片上传：uploadFile → POST /api/upload（本地磁盘，见 route.ts 图床 TODO）
// - AI 外部更新：initialContent 变化（AI 写库 / 切换文档）且用户未在编辑时，
//   事务性 replaceBlocks 应用，不打断用户输入
// - P1 对标 Notion：自定义 schema（callout 块）+ 自定义斜杠菜单（SuggestionMenuController）
import { useCallback, useEffect, useRef, useState } from "react";
// 0.54 起 @blocknote/react 的默认 UI 视图命名为 BlockNoteViewRaw（默认 UI 标志作 props）
import {
  BlockNoteViewRaw as BlockNoteView,
  getDefaultReactSlashMenuItems,
  SuggestionMenuController,
  useCreateBlockNote,
} from "@blocknote/react";
import { filterSuggestionItems, type PartialBlock } from "@blocknote/core";
import { syntaxHighlighter } from "@blocknote/code-block";
import "@blocknote/core/style.css";
import "@blocknote/react/style.css";
import { useTheme } from "next-themes";
import { isBlockNoteJson, toEditorBlocks } from "@/lib/content";
import { createLotionSchema } from "@/lib/blocknote-schema";
import { getSearch } from "@/lib/db";
import OutlinePanel from "@/components/editor/outline-panel";
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
      schema: createLotionSchema(),
      initialContent: initialBlocks,
      uploadFile: handleUpload,
      // 代码块语法高亮（shiki，@blocknote/code-block）
      extensions: [syntaxHighlighter],
    },
    [],
  );

  // 自定义 schema 下 replaceBlocks 的块参数类型（含 callout）
  type EditorPartialBlocks = Parameters<typeof editor.replaceBlocks>[1];

  // 斜杠菜单项：默认全部 + 自定义 Callout（对标 Notion）
  const getSlashMenuItems = useCallback(
    async (query: string) => {
      const defaultItems = getDefaultReactSlashMenuItems(editor);
      const calloutItem = {
        title: "Callout",
        subtext: "提示框",
        aliases: ["callout", "提示", "备注", "quote"],
        group: "基础",
        icon: <span className="text-base">💡</span>,
        onItemClick: () => {
          const { block } = editor.getTextCursorPosition();
          const newBlock = editor.insertBlocks(
            [{ type: "callout", props: { icon: "💡" }, content: [] }],
            block,
            "after",
          )[0];
          editor.setTextCursorPosition(newBlock, "start");
        },
      };
      return filterSuggestionItems([calloutItem, ...defaultItems], query);
    },
    [editor],
  );

  // @提及菜单：搜索当前用户文档，插入 mention 内联内容（对标 Notion @ 引用）
  const getMentionItems = useCallback(
    async (query: string) => {
      const q = query.trim().toLowerCase();
      const docs = await getSearch("");
      const matches = docs
        .filter((d) => !d.isArchived && d.title && (!q || d.title.toLowerCase().includes(q)))
        .slice(0, 8);
      if (matches.length === 0) {
        return [{ title: "未找到匹配的文档", group: "提及", onItemClick: () => {} }];
      }
      return matches.map((d) => ({
        title: d.title,
        subtext: d.parentDocument ? "子页面" : "页面",
        group: "提及",
        icon: d.icon ? <span className="text-base">{d.icon}</span> : undefined,
        onItemClick: () => {
          editor.insertInlineContent([{ type: "mention", props: { id: d.id, title: d.title } }]);
          editor.focus();
        },
      }));
    },
    [editor],
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
      const blocks = (isBlockNoteJson(initialContent)
        ? (JSON.parse(initialContent) as PartialBlock[])
        : await editor.tryParseMarkdownToBlocks(initialContent)) as EditorPartialBlocks;
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
      // 对标 Notion：显式开启全部默认 UI（格式工具栏 / 链接工具栏 /
      // 侧边拖拽菜单 / 表格手柄 / 文件面板）；斜杠菜单由下方
      // SuggestionMenuController 接管（默认项 + Callout）
      formattingToolbar
      slashMenu={false}
      sideMenu
      linkToolbar
      tableHandles
      filePanel
    >
      <SuggestionMenuController triggerCharacter="/" getItems={getSlashMenuItems} />
      <SuggestionMenuController triggerCharacter="@" getItems={getMentionItems} />
      {/* 右侧页面大纲（对标 Notion Outline；编辑态显示） */}
      {editable && <OutlinePanel editor={editor} />}
    </BlockNoteView>
  );
};

export default Editor;
