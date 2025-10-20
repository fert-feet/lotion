"use client";

import {
    Block,
    BlockNoteEditor,
    PartialBlock
} from "@blocknote/core";

import { BlockNoteView } from "@blocknote/shadcn";

import "@blocknote/core/style.css";
import { useCreateBlockNote, useEditorChange } from "@blocknote/react";
import { useTheme } from "next-themes";
import { useEdgeStore } from "../../../lib/edgestore";

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
    const { edgestore } = useEdgeStore();

    const handleUpload = async (file: File) => {
        const res = await edgestore.publicFiles.upload({
            file
        })

        return res.url
    };

    const editor: BlockNoteEditor = useCreateBlockNote({
        initialContent: initialContent ? JSON.parse(initialContent) as PartialBlock[] : undefined,
        uploadFile: handleUpload
    });


    return (
        <BlockNoteView
            onChange={(editor: BlockNoteEditor) => {
                onChange(JSON.stringify(editor.document, null, 2));
            }}
            editable={editable}
            editor={editor}
            theme={resolvedTheme == "dark" ? "dark" : "light"}
        />
    );
};

export default Editor;