"use client";

import {
    BlockNoteEditor,
    PartialBlock
} from "@blocknote/core";

import { BlockNoteView } from "@blocknote/shadcn";

import "@blocknote/core/style.css";
import { useCreateBlockNote } from "@blocknote/react";
import { useTheme } from "next-themes";
import { useCallback } from "react";
import { createClient } from "@/lib/supabase/client";

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

    const handleUpload = async (file: File) => {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error("Not authenticated");

        const fileExt = file.name.split(".").pop();
        const path = `uploads/${user.id}/${Date.now()}.${fileExt}`;

        const { error } = await supabase.storage.from("lotion").upload(path, file);
        if (error) throw error;

        const { data: urlData } = supabase.storage.from("lotion").getPublicUrl(path);
        return urlData.publicUrl;
    };

    const editor: BlockNoteEditor = useCreateBlockNote({
        initialContent: initialContent ? JSON.parse(initialContent) as PartialBlock[] : undefined,
        uploadFile: handleUpload
    });

    const onEditorChange = useCallback((editor: BlockNoteEditor) => {
        onChange(JSON.stringify(editor.document, null, 2));
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
