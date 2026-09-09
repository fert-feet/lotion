"use client";

import { update, type Document } from "@/lib/db";
import { useRefresh } from "@/hooks/use-refresh";
import React, { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

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
    // 标题写库防抖：击键期间只更新本地 state，停顿 400ms 才落库
    const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

    // 非编辑状态下，外部 props 变化时同步显示标题
    useEffect(() => {
        if (!isEditing && initialData.title) {
            setDisplayTitle(initialData.title);
        }
    }, [initialData.title, isEditing]);

    const enableInput = () => {
        // 编辑态点击输入框内部（移动光标）不应重置为数据库旧标题
        if (isEditing) return;
        setTitle(initialData.title);
        setIsEditing(true);

        setTimeout(() => {
            inputRef.current?.focus();
            inputRef.current?.setSelectionRange(0, inputRef.current.value.length);
        }, 0);
    };

    const disableInput = () => {
        const newTitle = title || "Untitled";
        // 取消未落库的防抖定时器，blur 时立即写入（避免与防抖重复写）
        if (saveTimer.current) {
            clearTimeout(saveTimer.current);
            saveTimer.current = undefined;
        }
        // 同步渲染：确保 displayTitle 立即生效，不被异步操作打断
        flushSync(() => {
            setIsEditing(false);
            setDisplayTitle(newTitle);
        });
        update(initialData.id, { title: newTitle }).then(() => {
            triggerDocument(initialData.id);
        });
    };

    const onChange = (
        e: React.ChangeEvent<HTMLInputElement>
    ) => {
        const value = e.target.value;
        setTitle(value);
        // 防抖写库：连续输入只更新 state，停顿后落库一次
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => {
            saveTimer.current = undefined;
            update(initialData.id, {
                title: value || "Untitled"
            });
        }, 400);
    };

    const onKeyDown = (
        e: React.KeyboardEvent<HTMLInputElement>
    ) => {
        if (e.key === "Enter") {
            disableInput();
        }
    };

    return (
        <div className="flex items-center gap-1">
            {!!initialData.icon && <span className="text-[13px] leading-none">{initialData.icon}</span>}
            {isEditing ? (
                <Input
                    ref={inputRef}
                    onClick={enableInput}
                    onBlur={disableInput}
                    onChange={onChange}
                    onKeyDown={onKeyDown}
                    value={title}
                    className="h-6 w-auto px-1.5 text-[13px] font-medium"
                />
            ) : (
                <Button
                    onClick={enableInput}
                    variant="ghost"
                    size="sm"
                    className="h-6 max-w-[42ch] cursor-pointer px-1.5 text-[13px] font-medium text-shell-label-secondary hover:text-shell-label-primary"
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
