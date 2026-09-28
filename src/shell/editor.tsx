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
import type { DefaultReactSuggestionItem } from "@blocknote/react";
import "@blocknote/core/style.css";
import "@blocknote/react/style.css";
import { useTheme } from "next-themes";
import { isBlockNoteJson, toEditorBlocks } from "@/lib/content";
import { createLotionSchema } from "@/lib/blocknote-schema";
import { createEditorSyncState, reduceEditorSync, type EditorSyncEvent } from "./editor-sync";
import { useDocStore } from "@/src/kernel/react";
import OutlinePanel from "@/components/editor/outline-panel";
import LotionSuggestionMenu from "@/components/editor/lotion-suggestion-menu";
import "@/components/editor/blocknote.css";

interface EditorProps {
  onChange: (value: string) => void;
  initialContent?: string;
  editable?: boolean;
}

const Editor = ({ onChange, initialContent, editable = true }: EditorProps) => {
  const docStore = useDocStore();
  const { resolvedTheme } = useTheme();

  // 本地版图片上传：POST /api/upload（本地磁盘存储，见 server/routes/upload.ts 的图床 TODO）
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

  // 斜杠菜单（对标 Notion）：默认项按 Notion 风格分组重排 + Callout
  const getSlashMenuItems = useCallback(
    async (query: string): Promise<DefaultReactSuggestionItem[]> => {
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

      // 默认英文分组 → Notion 风格中文分组
      const GROUP_MAP: Record<string, string> = {
        Headings: "基础",
        "Basic blocks": "基础",
        Subheadings: "其他",
        Media: "媒体",
        Advanced: "高级",
        Others: "其他",
      };
      const GROUP_ORDER = ["基础", "媒体", "高级", "其他"];
      const groupRank = (g?: string) => {
        const i = GROUP_ORDER.indexOf(g ?? "");
        return i >= 0 ? i : GROUP_ORDER.length;
      };
      const items = [
        ...defaultItems.map((i) => ({
          ...i,
          group: GROUP_MAP[i.group ?? ""] ?? i.group ?? "其他",
        })),
        calloutItem,
      ].sort((a, b) => groupRank(a.group) - groupRank(b.group));

      return filterSuggestionItems(items, query);
    },
    [editor],
  );

  // @提及菜单：搜索当前用户文档，插入 mention 内联内容（对标 Notion @ 引用）
  const getMentionItems = useCallback(
    async (query: string): Promise<DefaultReactSuggestionItem[]> => {
      const q = query.trim().toLowerCase();
      const docs = await docStore.listSearch({ userId: "" });
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
    [editor, docStore],
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

  // AI 修改文档 / 切换文档：外部内容变化时应用（用户优先，但**绝不丢弃**）。
  // 旧实现的坑：焦点在编辑器里时直接 return，却已经把 lastApplied 推进，
  // 这次更新被永久吞掉 —— 用户看到卡片写着"已更新"，正文纹丝不动。
  const [syncState, setSyncState] = useState(() => createEditorSyncState(initialContent ?? null));
  const syncRef = useRef(syncState);
  syncRef.current = syncState;

  /** 把外部内容事务性写进编辑器（不重建编辑器实例） */
  const applyExternal = useCallback(
    async (content: string) => {
      const blocks = (isBlockNoteJson(content)
        ? (JSON.parse(content) as PartialBlock[])
        : await editor.tryParseMarkdownToBlocks(content)) as EditorPartialBlocks;
      editor.transact(() => {
        editor.replaceBlocks(editor.document, blocks);
      });
    },
    [editor],
  );

  /** 消费状态机结果：apply 非空就写进编辑器 */
  const dispatchSync = useCallback(
    (event: EditorSyncEvent) => {
      const { state, apply } = reduceEditorSync(syncRef.current, event);
      syncRef.current = state;
      setSyncState(state);
      if (apply !== null) void applyExternal(apply);
    },
    [applyExternal],
  );

  // 外部内容变化（AI 写库 → 文档页 fresh 拉取 → initialContent 变化；切换文档同理）
  useEffect(() => {
    if (!initialContent) return;
    dispatchSync({ type: "external", content: initialContent, focused: editor.isFocused() });
  }, [initialContent, editor, dispatchSync]);

  // 失焦补应用：焦点内的更新挂起，用户松手（未继续编辑）后自动落地
  useEffect(() => {
    const onFocusOut = () => {
      // 等一帧：点击编辑器内部元素（工具栏/菜单）也会触发 focusout
      window.setTimeout(() => {
        if (!editor.isFocused()) dispatchSync({ type: "blur" });
      }, 0);
    };
    document.addEventListener("focusout", onFocusOut);
    return () => document.removeEventListener("focusout", onFocusOut);
  }, [editor, dispatchSync]);

  const onEditorChange = useCallback(
    (e: typeof editor) => {
      // 挂起期间用户继续编辑 → 不再自动覆盖（保留提示，由用户点"载入"）
      if (syncRef.current.pending) dispatchSync({ type: "user-edit" });
      // 规范存储格式为 BlockNote JSON（无损，保留块 ID）
      onChange(JSON.stringify(e.document));
    },
    [onChange, dispatchSync],
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
      <SuggestionMenuController
        triggerCharacter="/"
        getItems={getSlashMenuItems}
        suggestionMenuComponent={LotionSuggestionMenu}
      />
      <SuggestionMenuController
        triggerCharacter="@"
        getItems={getMentionItems}
        suggestionMenuComponent={LotionSuggestionMenu}
      />
      {/* 右侧页面大纲（对标 Notion Outline；编辑态显示） */}
      {editable && <OutlinePanel editor={editor} />}
      {/* AI 更新与本地编辑冲突时的提示：绝不静默覆盖，也不静默丢弃 */}
      {syncState.pending && (
        <div
          role="status"
          className="material-popover absolute right-6 top-2 z-30 flex items-center gap-2 rounded-[10px] border-[0.5px] border-shell-border-l2 px-3 py-1.5 text-xs text-shell-label-primary shadow-[var(--shadow-md)]"
        >
          <span>文档已被 AI 更新，你正在编辑</span>
          <button
            type="button"
            onClick={() => dispatchSync({ type: "apply-pending" })}
            className="cursor-pointer rounded-md bg-primary px-2 py-0.5 text-[11px] font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            载入更新
          </button>
          <button
            type="button"
            onClick={() => dispatchSync({ type: "dismiss-pending" })}
            className="cursor-pointer rounded-md px-2 py-0.5 text-[11px] font-medium text-shell-label-secondary transition-colors hover:bg-shell-row-hover"
          >
            忽略
          </button>
        </div>
      )}
    </BlockNoteView>
  );
};

export default Editor;
