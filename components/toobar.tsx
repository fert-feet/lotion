import { ImageIcon, Smile, X } from "@/components/icons";
import { type Document } from "@/lib/db";
import IconPicker from "./icon-picker";
import { Button } from "./ui/button";
import { ElementRef, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { update, removeIcon } from "@/lib/db";
import { useRefresh } from "@/hooks/use-refresh";
import TextareaAutosize from "react-textarea-autosize";
import useCoverImage from "../hooks/use-cover-image";

interface ToolbarProps {
    initialData: Document | undefined;
    preview?: boolean;
}

const Toolbar = ({
    initialData,
    preview
}: ToolbarProps) => {
    const coverImage = useCoverImage();
    const triggerDocument = useRefresh((s) => s.triggerDocument);
    const triggerSidebar = useRefresh((s) => s.triggerSidebar);
    const inputRef = useRef<ElementRef<"textarea">>(null);
    const [isEditing, setIsEditing] = useState<boolean>(false);
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
        const newValue = value || "Untitled";
        // 取消未落库的防抖定时器，blur 时立即写入（避免与防抖重复写）
        if (saveTimer.current) {
            clearTimeout(saveTimer.current);
            saveTimer.current = undefined;
        }
        flushSync(() => {
            setIsEditing(false);
            setDisplayValue(newValue);
        });
        update(initialData.id, { title: newValue }).then(() => {
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
            update(initialData.id, { title: value || "Untitled" });
        }, 400);
    };

    const onSelectIcon = (icon: string) => {
        update(initialData.id, { icon }).then(() => {
            triggerDocument(initialData.id);
            triggerSidebar(); // 侧边栏同步显示新 icon
        });
    };

    const onRemoveIcon = () => {
        removeIcon(initialData.id).then(() => {
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
        <div className="pl-[54px] group relative">
            {!!initialData.icon && !preview && (
                <div className="flex items-center gap-x-2 group/icon pt-6">
                    <IconPicker onChange={onSelectIcon}>
                        <p className="text-6xl hover:opacity-75 transition cursor-pointer">
                            {initialData.icon}
                        </p>
                    </IconPicker>
                    <Button
                        onClick={onRemoveIcon}
                        className="rounded-full opacity-0 group-hover/icon:opacity-100 max-md:opacity-100 transition text-muted-foreground text-xs"
                        variant={"outline"}
                        size={"icon"}
                    >
                        <X className="h-4 w-4" />
                    </Button>
                </div>
            )}
            {!!initialData.icon && preview && (
                <p className="text-6xl pt-6">
                    {initialData.icon}
                </p>
            )}
            <div className="flex items-center gap-x-1 group-hover:opacity-100 opacity-0 max-md:opacity-100 py-4">
                {!initialData.icon && !preview && (
                    <IconPicker onChange={onSelectIcon}>
                        <Button
                            asChild
                            className="text-muted-foreground text-xs cursor-pointer"
                            variant={"outline"}
                            size={"sm"}
                        >
                            <div>
                                <Smile className="h-4 w-4 mr-2" />
                                Add icon
                            </div>
                        </Button>
                    </IconPicker>
                )}
                {!initialData.coverImage && !preview && (
                    <Button
                        onClick={coverImage.onOpen}
                        className="text-muted-foreground text-xs cursor-pointer"
                        variant={"outline"}
                        size={"sm"}
                    >
                        <ImageIcon className="h-4 w-4 mr-2" />
                        Add Cover
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
                    className="font-display text-5xl bg-transparent outline-none font-semibold break-words text-shell-label-primary dark:text-shell-label-primary resize-none"
                />
            ) : (
                <div
                    onClick={enableInput}
                    className="pb-[11.5px] font-display text-5xl font-semibold break-words outline-none text-shell-label-primary dark:text-shell-label-primary resize-none"
                >
                    {displayValue}
                </div>
            )}
        </div>
    );
};

export default Toolbar;
