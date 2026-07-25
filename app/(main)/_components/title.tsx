"use client";

import { update, type Document } from "@/lib/db";
import { useRefresh } from "@/hooks/use-refresh";
import React, { useEffect, useRef, useState } from "react";
import { Input } from "../../../components/ui/input";
import { Button } from "../../../components/ui/button";
import { Skeleton } from "../../../components/ui/skeleton";

interface TitleProps {
    initialData: Document;
}

const Title = ({
    initialData
}: TitleProps) => {
    const inputRef = useRef<HTMLInputElement>(null);
    const triggerDocument = useRefresh((s) => s.triggerDocument);

    const [isEditing, setIsEditing] = useState<boolean>(false);
    const [title, setTitle] = useState(initialData.title || "Untitled");
    // 本地显示的标题：编辑中用自己的 state，失焦立即同步避免闪烁
    const [displayTitle, setDisplayTitle] = useState(initialData.title || "Untitled");

    // 非编辑状态下，外部 props 变化时同步显示标题
    useEffect(() => {
        if (!isEditing && initialData.title) {
            setDisplayTitle(initialData.title);
        }
    }, [initialData.title, isEditing]);

    const enableInput = () => {
        setTitle(initialData.title);
        setIsEditing(true);

        setTimeout(() => {
            inputRef.current?.focus();
            inputRef.current?.setSelectionRange(0, inputRef.current.value.length);
        }, 0);
    };

    const disableInput = () => {
        setIsEditing(false);
        setDisplayTitle(title); // 立即显示用户输入的新标题，不等远端刷新
        // Wait for the final update to complete before triggering refresh,
        // so the re-fetch gets the latest title from DB.
        update(initialData.id, { title: title || "Untitled" }).then(() => {
            triggerDocument(initialData.id);
        });
    };

    const onChange = (
        e: React.ChangeEvent<HTMLInputElement>
    ) => {
        setTitle(e.target.value);
        update(initialData.id, {
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
                        {displayTitle}
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
