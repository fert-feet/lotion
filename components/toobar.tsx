import { History, ImageIcon, Smile, X } from "@/components/icons";
import type { Document } from "@/lib/seams/doc-store";
import { useActor, useDocStore } from "@/src/kernel/react";
import IconPicker from "./icon-picker";
import { Button } from "./ui/button";
import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useRefresh } from "@/hooks/use-refresh";
import TextareaAutosize from "react-textarea-autosize";
import useCoverImage from "../hooks/use-cover-image";
import { VersionHistoryDialog } from "./modals/version-history-dialog";

interface ToolbarProps {
    initialData: Document | undefined;
    preview?: boolean;
}

const Toolbar = ({
    initialData,
    preview
}: ToolbarProps) => {
    const docStore = useDocStore();
    const actor = useActor();
    const coverImage = useCoverImage();
    const triggerDocument = useRefresh((s) => s.triggerDocument);
    const triggerSidebar = useRefresh((s) => s.triggerSidebar);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const [isEditing, setIsEditing] = useState<boolean>(false);
    // 版本历史：从工具栏的 History 按钮打开（预览模式不出现）
    const [historyOpen, setHistoryOpen] = useState(false);
    const [value, setValue] = useState(initialData?.title || "");
    const [displayValue, setDisplayValue] = useState(initialData?.title || "");
    // 标题写库防抖：击键期间只更新本地 state，停顿 400ms 才落库
    const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    // 记录上次应用的外部标题：仅外部 title 变化（AI 修改/reload）时同步 displayValue，
    // 避免失焦瞬间 isEditing 变化触发 effect 用旧标题覆盖新值（新→旧→新闪烁）
    const lastAppliedTitle = useRef(initialData?.title);

    useEffect(() => {
        if (isEditing) return;
        if (!initialData?.title || lastAppliedTitle.current === initialData.title) return;
        lastAppliedTitle.current = initialData.title;
        setDisplayValue(initialData.title);
    }, [initialData?.title, isEditing]);

    if (!initialData) {
        return null;
    }

    const enableInput = () => {
        if (preview) {
            return;
        }

        setIsEditing(true);

        setTimeout(() => {
            setValue(initialData.title);
            inputRef.current?.focus();
        }, 0);
    };

    const disableInput = () => {
        const newValue = value || "未命名";
        // 取消未落库的防抖定时器，blur 时立即写入（避免与防抖重复写）
        if (saveTimer.current) {
            clearTimeout(saveTimer.current);
            saveTimer.current = undefined;
        }
        flushSync(() => {
            setIsEditing(false);
            setDisplayValue(newValue);
        });
        docStore.update(actor, initialData.id, { title: newValue }).then(() => {
            triggerDocument(initialData.id);
            triggerSidebar(); // 侧边栏同步显示新标题
        });
    };

    const onInput = (value: string) => {
        setValue(value);
        // 防抖写库：连续输入只更新 state，停顿后落库一次
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => {
            saveTimer.current = undefined;
            docStore.update(actor, initialData.id, { title: value || "未命名" });
        }, 400);
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
            {Boolean(initialData.icon) && !preview && (
                <div className="flex items-center gap-x-2 group/icon pt-6">
                    <IconPicker onChange={onSelectIcon}>
                        <p className="text-hero leading-none transition-opacity hover:opacity-70 cursor-pointer">
                            {initialData.icon}
                        </p>
                    </IconPicker>
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
                </div>
            )}
            {Boolean(initialData.icon) && preview && (
                <p className="text-hero leading-none pt-6">
                    {initialData.icon}
                </p>
            )}
            <div className="flex items-center gap-1 py-3 opacity-0 transition-opacity group-hover:opacity-100 max-md:opacity-100">
                {!initialData.icon && !preview && (
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
                {!preview && (
                    <Button
                        onClick={() => setHistoryOpen(true)}
                        className="cursor-pointer text-shell-label-secondary"
                        variant={"outline"}
                        size={"sm"}
                    >
                        <History className="h-4 w-4 mr-2" />
                        历史
                    </Button>
                )}
                {!initialData.coverImage && !preview && (
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
            {isEditing && !preview ? (
                <TextareaAutosize
                    ref={inputRef}
                    onBlur={disableInput}
                    onKeyDown={onKeyDown}
                    value={value}
                    onChange={(e) => onInput(e.target.value)}
                    className="w-full resize-none break-words bg-transparent text-display font-bold leading-[1.15] tracking-[-0.022em] text-shell-label-primary outline-none"
                />
            ) : (
                <div
                    onClick={enableInput}
                    className="cursor-text pb-1 text-display font-bold leading-[1.15] tracking-[-0.022em] break-words text-shell-label-primary outline-none"
                >
                    {displayValue}
                </div>
            )}
        </div>
        <VersionHistoryDialog
            documentId={preview ? null : initialData.id}
            open={historyOpen}
            onOpenChange={setHistoryOpen}
            onRestored={() => triggerDocument(initialData.id)}
        />
        </>
    );
};

export default Toolbar;
