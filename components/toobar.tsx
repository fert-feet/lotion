import { ImageIcon, Smile, X } from "lucide-react";
import { type Document } from "@/lib/db";
import IconPicker from "./icon-picker";
import { Button } from "./ui/button";
import { ElementRef, useEffect, useRef, useState } from "react";
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
    const inputRef = useRef<ElementRef<"textarea">>(null);
    const [isEditing, setIsEditing] = useState<boolean>(false);
    const [value, setValue] = useState(initialData?.title || "");
    const [displayValue, setDisplayValue] = useState(initialData?.title || "");

    useEffect(() => {
        if (!isEditing && initialData?.title) {
            setDisplayValue(initialData.title);
        }
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
        setIsEditing(false);
        setDisplayValue(value); // 立即显示新标题
        update(initialData.id, { title: value || "Untitled" }).then(() => {
            triggerDocument(initialData.id);
        });
    };

    const onInput = (value: string) => {
        setValue(value);
        update(initialData.id, { title: value || "Untitled" });
    };

    const onSelectIcon = (icon: string) => {
        update(initialData.id, { icon }).then(() => triggerDocument(initialData.id));
    };

    const onRemoveIcon = () => {
        removeIcon(initialData.id).then(() => triggerDocument(initialData.id));
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
                        className="rounded-full opacity-0 group-hover/icon:opacity-100 transition text-muted-foreground text-xs"
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
            <div className="flex items-center gap-x-1 group-hover:opacity-100 opacity-0 py-4">
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
                    className="text-5xl bg-transparent outline-none font-bold break-words text-[#3f3f3f] dark:text-[#cfcfcf] resize-none"
                />
            ) : (
                <div
                    onClick={enableInput}
                    className="pb-[11.5px] text-5xl font-bold break-words outline-none text-[#3f3f3f] dark:text-[#cfcfcf] resize-none"
                >
                    {displayValue}
                </div>
            )}
        </div>
    );
};

export default Toolbar;
