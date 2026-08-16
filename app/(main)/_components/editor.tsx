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

    // 挂载时解析文档内容：损坏 JSON（AI 工具写入截断等）不崩溃，退化为空文档
    let initialBlocks: PartialBlock[] | undefined;
    if (initialContent) {
        try {
            initialBlocks = JSON.parse(initialContent) as PartialBlock[];
        } catch {
            console.warn("文档内容 JSON 解析失败，按空文档打开");
        }
    }

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
        try {
            const blocks = JSON.parse(initialContent) as PartialBlock[];
            editor.replaceBlocks(editor.document, blocks);
        } catch {
            // 非法 JSON 时忽略，保持现状
        }
    }, [initialContent, editor]);

    const onEditorChange = useCallback((editor: BlockNoteEditor) => {
        // 无缩进序列化：JSON.stringify(x, null, 2) 的空白占 30-50% 体积，
        // 每次防抖写库都全量传输，紧凑序列化显著降低 payload
        onChange(JSON.stringify(editor.document));
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
