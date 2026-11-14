"use client";

// 危险操作确认（销毁类）：默认文案点名「无法撤销」，主按钮用 destructive 而不是 systemBlue —
// 蓝色确认键会让「永久删除」看起来像普通保存。
import React from "react";
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
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>{title}</AlertDialogTitle>
                    <AlertDialogDescription>{description}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel onClick={(e) => e.stopPropagation()} className="cursor-pointer">
                        取消
                    </AlertDialogCancel>
                    <AlertDialogAction variant="destructive" onClick={handleConfirm} className="cursor-pointer">
                        {confirmText}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
};

export default ConfirmModal;
