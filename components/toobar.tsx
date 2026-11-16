import { History, ImageIcon, Smile, X } from "@/components/icons";
import type { Document } from "@/lib/seams/doc-store";
import { useActor, useDocStore } from "@/src/kernel/react";
import IconPicker from "./icon-picker";
import { Button } from "./ui/button";
import { useEffect, useRef, useState } from "react";
import { useRefresh } from "@/hooks/use-refresh";
import TextareaAutosize from "react-textarea-autosize";
import useCoverImage from "../hooks/use-cover-image";
import { VersionHistoryDialog } from "./modals/version-history-dialog";
import { isImeConfirmingKey } from "@/lib/ime";

interface ToolbarProps {
    initialData: Document;
    title: string;
    onTitleChange: (title: string) => void;
    onTitleCommit: (title: string) => void;
}

const Toolbar = ({
    initialData,
    title,
    onTitleChange,
    onTitleCommit,
}: ToolbarProps) => {
    const docStore = useDocStore();
    const actor = useActor();
    const coverImage = useCoverImage();
    const triggerDocument = useRefresh((s) => s.triggerDocument);
    const triggerSidebar = useRefresh((s) => s.triggerSidebar);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const readOnly = initialData.isArchived;
    const [isEditing, setIsEditing] = useState<boolean>(false);
    // 版本历史：从工具栏的 History 按钮打开
    const [historyOpen, setHistoryOpen] = useState(false);
    const [value, setValue] = useState(title);

    useEffect(() => {
        if (!isEditing) setValue(title);
    }, [isEditing, title]);

    const enableInput = () => {
        if (readOnly) return;
        setValue(title);
        setIsEditing(true);

        setTimeout(() => {
            inputRef.current?.focus();
            inputRef.current?.setSelectionRange(0, inputRef.current.value.length);
        }, 0);
    };

    const disableInput = () => {
        const newValue = value || "未命名";
        setIsEditing(false);
        setValue(newValue);
        onTitleCommit(newValue);
    };

    const onInput = (value: string) => {
        setValue(value);
        onTitleChange(value);
    };

    const onSelectIcon = (icon: string) => {
        docStore.update(actor, initialData.id, { icon }).then(() => {
            triggerDocument(initialData.id);
            triggerSidebar(); // 侧边栏同步显示新 icon
        });
    };

    const onRemoveIcon = () => {
        docStore.removeIcon(actor, initialData.id).then(() => {
            triggerDocument(initialData.id);
            triggerSidebar(); // 侧边栏同步移除 icon
        });
    };

    const onKeyDown = (
        e: React.KeyboardEvent<HTMLTextAreaElement>
    ) => {
        if (e.key === "Enter") {
            e.preventDefault();
            if (isImeConfirmingKey(e.nativeEvent)) return;
            disableInput();
        }
    };

    return (
        <>
        <div className="document-title-rail group relative">
            {Boolean(initialData.icon) && (
                <div className="flex items-center gap-x-2 group/icon pt-6">
                    {readOnly ? (
                        <p className="text-hero leading-none">{initialData.icon}</p>
                    ) : (
                    <IconPicker onChange={onSelectIcon}>
                        <button
                            type="button"
                            aria-label="更换文档图标"
                            className="cursor-pointer rounded-control p-0 text-hero leading-none transition-opacity hover:opacity-70 focus-visible:opacity-100"
                        >
                            {initialData.icon}
                        </button>
                    </IconPicker>
                    )}
                    {!readOnly && (
                    <Button
                        type="button"
                        onClick={onRemoveIcon}
                        aria-label="移除图标"
                        className="pointer-events-none size-8 text-shell-label-secondary opacity-0 transition-opacity group-hover/icon:pointer-events-auto group-hover/icon:opacity-100 group-focus-within/icon:pointer-events-auto group-focus-within/icon:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100"
                        variant={"outline"}
                        size={"icon"}
                    >
                        <X className="h-4 w-4" aria-hidden="true" />
                    </Button>
                    )}
                </div>
            )}
            {!readOnly && (
            <div className="pointer-events-none flex flex-wrap items-center gap-1 py-3 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100">
                {!initialData.icon && (
                    <IconPicker onChange={onSelectIcon}>
                        <Button
                            className="cursor-pointer text-shell-label-secondary"
                            variant={"outline"}
                            size={"sm"}
                        >
                            <Smile className="h-4 w-4 mr-2" />
                            添加图标
                        </Button>
                    </IconPicker>
                )}
                <Button
                    onClick={() => setHistoryOpen(true)}
                        className="cursor-pointer text-shell-label-secondary"
                        variant={"outline"}
                        size={"sm"}
                    >
                    <History className="h-4 w-4 mr-2" />
                    历史
                </Button>
                {!initialData.coverImage && (
                    <Button
                        onClick={coverImage.onOpen}
                        className="cursor-pointer text-shell-label-secondary"
                        variant={"outline"}
                        size={"sm"}
                    >
                        <ImageIcon className="h-4 w-4 mr-2" />
                        添加封面
                    </Button>
                )}
            </div>
            )}
            {!readOnly && isEditing ? (
                <TextareaAutosize
                    ref={inputRef}
                    onBlur={disableInput}
                    onKeyDown={onKeyDown}
                    value={value}
                    onChange={(e) => onInput(e.target.value)}
                    aria-label="文档标题"
                    className="w-full resize-none break-words bg-transparent text-title font-bold leading-[1.15] tracking-[-0.022em] text-shell-label-primary outline-none sm:text-display"
                />
            ) : readOnly ? (
                <div className="pb-1 text-title font-bold leading-[1.15] tracking-[-0.022em] break-words text-shell-label-primary sm:text-display">
                    {title || "未命名"}
                </div>
            ) : (
                <button
                    type="button"
                    onClick={enableInput}
                    aria-label="编辑文档标题"
                    className="block w-full cursor-text break-words rounded-control pb-1 text-left text-title font-bold leading-[1.15] tracking-[-0.022em] text-shell-label-primary outline-none focus-visible:ring-[3px] focus-visible:ring-ring sm:text-display"
                >
                    {title || "未命名"}
                </button>
            )}
        </div>
        <VersionHistoryDialog
            documentId={initialData.id}
            open={historyOpen}
            onOpenChange={setHistoryOpen}
            onRestored={() => triggerDocument(initialData.id)}
        />
        </>
    );
};

export default Toolbar;
