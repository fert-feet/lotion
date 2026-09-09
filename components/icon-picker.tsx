"use client";

import { Suspense, lazy } from "react";
import { useTheme } from "next-themes";
import type { Theme } from "emoji-picker-react";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";

// 按需加载：emoji-picker-react（~827KB）只在用户点开图标选择器时才加载，
// 避免进入编辑页首屏就下载（radix Popover 打开前 content 不挂载，天然触发懒加载）。
// 迁移自 next/dynamic（{ ssr:false }）→ React.lazy + Suspense。
const EmojiPicker = lazy(() => import("emoji-picker-react"));

interface IconPickerProps {
    onChange: (icon: string) => void;
    children: React.ReactNode;
    asChild?: boolean;
}

const IconPicker = ({
    onChange,
    children
}: IconPickerProps) => {
    const { resolvedTheme } = useTheme();

    return (
        <Popover>
            <PopoverTrigger>
                {children}
            </PopoverTrigger>
            <PopoverContent className="p-0 w-full border-none shadow-none">
                <Suspense fallback={<div className="h-[350px]" />}>
                    <EmojiPicker
                        height={350}
                        theme={(resolvedTheme === "dark" ? "dark" : "light") as Theme}
                        onEmojiClick={(data) => onChange(data.emoji)}
                    />
                </Suspense>
            </PopoverContent>
        </Popover>
    );
};

export default IconPicker;
