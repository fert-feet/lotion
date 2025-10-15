import { ImageIcon, Smile, X } from "lucide-react";
import { Doc } from "../convex/_generated/dataModel";
import IconPicker from "./icon-picker";
import { Button } from "./ui/button";
import { ElementRef, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../convex/_generated/api";

import TextareaAutosize from "react-textarea-autosize";

interface ToolbarProps {
    initialData: Doc<"documents"> | undefined;
    preview?: boolean;
}

const Toolbar = ({
    initialData,
    preview
}: ToolbarProps) => {
    if (!initialData) {
        return null;
    }

    const inputRef = useRef<ElementRef<"textarea">>(null);
    const update = useMutation(api.documents.update);
    const removeIcon = useMutation(api.documents.removeIcon);

    const [isEditing, setIsEditing] = useState<boolean>(false);
    const [value, setValue] = useState(initialData.title);

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
    };

    const onInput = (value: string) => {
        setValue(value);
        update({
            id: initialData._id,
            title: value || "Untitled"
        });
    };

    const onSeleteIcon = (icon: string) => {
        update({
            id: initialData._id,
            icon: icon
        })
    }

    const onRemoveIcon = () => {
        removeIcon({
            id: initialData._id
        })
    }

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
                    <IconPicker onChange={onSeleteIcon}>
                        <p className="text-6xl hover:opacity-75 transition">
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
                    <IconPicker asChild onChange={onSeleteIcon}>
                        <Button
                            className="text-muted-foreground text-xs cursor-pointer"
                            variant={"outline"}
                            size={"sm"}
                        >
                            <Smile className="h-4 w-4 mr-2" />
                            Add icon
                        </Button>
                    </IconPicker>
                )}
                {!initialData.coverImage && !preview && (
                    <Button
                        onClick={() => { }}
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
                    {initialData.title}
                </div>
            )}
        </div>
    );
};

export default Toolbar;