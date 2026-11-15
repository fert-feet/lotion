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
            disableInput();
        }
    };

    return (
        <>
        <div className="pl-[54px] group relative">
            {Boolean(initialData.icon) && (
                <div className="flex items-center gap-x-2 group/icon pt-6">
                    {readOnly ? (
                        <p className="text-hero leading-none">{initialData.icon}</p>
                    ) : (
                    <IconPicker onChange={onSelectIcon}>
                        <p className="text-hero leading-none transition-opacity hover:opacity-70 cursor-pointer">
                            {initialData.icon}
                        </p>
                    </IconPicker>
                    )}
                    {!readOnly && (
                    <Button
                        type="button"
                        onClick={onRemoveIcon}
                        aria-label="移除图标"
                        className="size-8 opacity-0 transition-opacity group-hover/icon:opacity-100 max-md:opacity-100 text-shell-label-secondary"
                        variant={"outline"}
                        size={"icon"}
                    >
                        <X className="h-4 w-4" aria-hidden="true" />
                    </Button>
                    )}
                </div>
            )}
            {!readOnly && (
            <div className="flex items-center gap-1 py-3 opacity-0 transition-opacity group-hover:opacity-100 max-md:opacity-100">
                {!initialData.icon && (
                    <IconPicker onChange={onSelectIcon}>
                        <Button
                            asChild
                            className="cursor-pointer text-shell-label-secondary"
                            variant={"outline"}
                            size={"sm"}
                        >
                            <div>
                                <Smile className="h-4 w-4 mr-2" />
                                添加图标
                            </div>
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
                    className="w-full resize-none break-words bg-transparent text-display font-bold leading-[1.15] tracking-[-0.022em] text-shell-label-primary outline-none"
                />
            ) : readOnly ? (
                <div className="pb-1 text-display font-bold leading-[1.15] tracking-[-0.022em] break-words text-shell-label-primary">
                    {title || "未命名"}
                </div>
            ) : (
                <button
                    type="button"
                    onClick={enableInput}
                    aria-label="编辑文档标题"
                    className="block w-full cursor-text break-words rounded-control pb-1 text-left text-display font-bold leading-[1.15] tracking-[-0.022em] text-shell-label-primary outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
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
