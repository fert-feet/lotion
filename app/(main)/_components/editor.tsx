"use client";

// 编辑器入口（阶段 2b）：自研块编辑器（components/editor/block-editor.tsx）替换 BlockNote。
// 文档模型为 Markdown 原文（阶段 1）；图片上传/斜杠菜单等高级能力见 BlockEditor 注释的 MVP 边界。
import BlockEditor from "@/components/editor/block-editor";

interface EditorProps {
  onChange: (value: string) => void;
  initialContent?: string;
  editable?: boolean;
}

const Editor = ({ onChange, initialContent, editable }: EditorProps) => {
  return <BlockEditor onChange={onChange} initialContent={initialContent} editable={editable} />;
};

export default Editor;
