"use client";

import {
    BlockNoteEditor,
    PartialBlock
} from "@blocknote/core";

import { BlockNoteView } from "@blocknote/shadcn";

import "@blocknote/core/style.css";
import { useCreateBlockNote } from "@blocknote/react";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useRef } from "react";
import { isBlockNoteJson, toEditorBlocks } from "@/lib/content";

interface EditorProps {
    onChange: (value: string) => void;
    initialContent?: string;
    editable?: boolean;
}

const Editor = ({
    onChange,
    initialContent,
    editable
}: EditorProps) => {
    const { resolvedTheme } = useTheme();

    // 本地版图片上传：POST /api/upload（本地磁盘存储，见 app/api/upload/route.ts 的图床 TODO）
    const handleUpload = async (file: File) => {
        const form = new FormData();
        form.append("file", file);
        const res = await fetch("/api/upload", { method: "POST", body: form });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "上传失败");
        return data.url as string;
    };

    // 内容适配层：旧 BlockNote JSON 直接解析；Markdown（新格式）由 editor
    // 实例方法 tryParseMarkdownToBlocks 在数据到达后填充（模块级转换需 pmSchema）
    const initialBlocks = toEditorBlocks(initialContent);

    const editor: BlockNoteEditor = useCreateBlockNote({
        initialContent: initialBlocks,
        uploadFile: handleUpload
    });

    // AI 修改文档后 initialContent 变化：initialContent 只在创建时生效，
    // 这里手动把新内容替换进已挂载的编辑器（内容没变时不操作，避免打断用户编辑）
    const lastAppliedContent = useRef<string | undefined>(initialContent);
    useEffect(() => {
        if (!initialContent || lastAppliedContent.current === initialContent) return;
        lastAppliedContent.current = initialContent;
        const blocks = isBlockNoteJson(initialContent)
            ? (JSON.parse(initialContent) as PartialBlock[])
            : editor.tryParseMarkdownToBlocks(initialContent);
        editor.replaceBlocks(editor.document, blocks);
    }, [initialContent, editor]);

    const onEditorChange = useCallback((editor: BlockNoteEditor) => {
        // 阶段 1 过渡：编辑器产物经 blocksToMarkdownLossy 转回 Markdown 存库，
        // 文档模型统一为 Markdown（AI 工具同格式读写，无损对接）
        onChange(editor.blocksToMarkdownLossy());
    }, [onChange]);

    return (
        <BlockNoteView
            onChange={onEditorChange}
            editable={editable}
            editor={editor}
            theme={resolvedTheme == "dark" ? "dark" : "light"}
        />
    );
};

export default Editor;
