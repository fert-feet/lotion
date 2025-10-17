"use client";

import {
    BlockNoteEditor,
    PartialBlock
} from "@blocknote/core";

import "@blocknote/core/style.css"

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
    


    return (
        <div>
            Editor
        </div>
    );
};

export default Editor;