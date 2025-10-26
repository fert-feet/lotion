"use client";

import { useMutation } from "convex/react";
import { Doc } from "../../../convex/_generated/dataModel";
import { api } from "../../../convex/_generated/api";
import React, { useRef, useState } from "react";
import { Input } from "../../../components/ui/input";
import { Button } from "../../../components/ui/button";
import { Skeleton } from "../../../components/ui/skeleton";

interface TitleProps {
    initialData: Doc<"documents">;
}

const Title = ({
    initialData
}: TitleProps) => {
    const inputRef = useRef<HTMLInputElement>(null);
    const update = useMutation(api.documents.update);

    const [isEditing, setIsEditing] = useState<boolean>(false);
    const [title, setTitle] = useState(initialData.title || "Untitled");

    const enableInput = () => {
        setTitle(initialData.title);
        setIsEditing(true);

        // 推迟到当前循环的末尾，即等待 setIsEditing(true) 完成后再进行下面代码的操作，因为set 操作是异步的
        setTimeout(() => {
            inputRef.current?.focus();
            inputRef.current?.setSelectionRange(0, inputRef.current.value.length);
        }, 0);
    };

    const disableInput = () => {
        setIsEditing(false);
    };

    const onChange = (
        e: React.ChangeEvent<HTMLInputElement>
    ) => {
        setTitle(e.target.value);
        update({
            id: initialData._id,
            title: e.target.value || "Untitled"
        });
    };

    const onKeyDown = (
        e: React.KeyboardEvent<HTMLInputElement>
    ) => {
        if (e.key === "Enter") {
            disableInput();
        }
    };

    return (
        <div className="flex items-center gap-x-1">
            {!!initialData.icon && <p>{initialData.icon}</p>}
            {isEditing ? (
                <Input
                    ref={inputRef}
                    onClick={enableInput}
                    onBlur={disableInput}
                    onChange={onChange}
                    onKeyDown={onKeyDown}
                    value={title}
                    className="h-7 px-2 focus-visible:ring-transparent"
                />
            ) : (
                <Button
                    onClick={enableInput}
                    variant="ghost"
                    size="sm"
                    className="font-normal h-auto p-1 cursor-pointer"
                >
                    <span className="truncate">
                        {initialData?.title}
                    </span>
                </Button>
            )}
        </div>
    );
};

Title.Skeleton = function TitleSkeleton() {
    return (
        <Skeleton className="mt-1 h-5.5 w-20 rounded-sm" />
    );
};

export default Title;