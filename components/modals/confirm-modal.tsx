"use client";

// 危险操作确认（销毁类）：默认文案点名「无法撤销」，主按钮用 destructive 而不是 systemBlue —
// 蓝色确认键会让「永久删除」看起来像普通保存。
import React from "react";
import { AlertTriangle } from "@/components/icons";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "../ui/alert-dialog";

interface ConfirmModalProps {
    children: React.ReactNode;
    onConfirm: () => void;
    /** 弹窗标题，默认「确定要删除吗？」 */
    title?: string;
    /** 一句话后果说明，默认「此操作无法撤销。」 */
    description?: string;
    /** 确认键文案，默认「删除」 */
    confirmText?: string;
}

const ConfirmModal = ({
    children,
    onConfirm,
    title = "确定要删除吗？",
    description = "此操作无法撤销。",
    confirmText = "删除",
}: ConfirmModalProps) => {
    const handleConfirm = (
        e: React.MouseEvent<HTMLButtonElement, MouseEvent>
    ) => {
        e.stopPropagation();
        onConfirm();
    };

    return (
        <AlertDialog>
            <AlertDialogTrigger onClick={(e) => e.stopPropagation()} asChild>
                {children}
            </AlertDialogTrigger>
            <AlertDialogContent className="max-w-sm">
                <AlertDialogHeader className="mb-4 flex-row items-start gap-3 text-left">
                    <span className="flex size-9 flex-none items-center justify-center rounded-card bg-destructive/10 text-destructive">
                        <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <div className="min-w-0 flex-1">
                        <AlertDialogTitle>{title}</AlertDialogTitle>
                        <AlertDialogDescription className="mt-1 text-shell-label-secondary">
                            {description}
                        </AlertDialogDescription>
                    </div>
                </AlertDialogHeader>
                <AlertDialogFooter className="mt-1 hairline-t border-shell-border pt-4">
                    <AlertDialogCancel onClick={(e) => e.stopPropagation()} className="min-w-20 cursor-pointer">
                        取消
                    </AlertDialogCancel>
                    <AlertDialogAction variant="destructive" onClick={handleConfirm} className="min-w-20 cursor-pointer">
                        {confirmText}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
};

export default ConfirmModal;
