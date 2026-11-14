"use client";

import { useParams } from "react-router";
import { MenuIcon } from "@/components/icons";
import Title from "./title";
import Banner from "./banner";
import Menu from "./menu";
import Publish from "./publish";
import { useEffect, useState } from "react";
import type { Document } from "@/lib/seams/doc-store";
import { useActor, useDocStore } from "@/src/kernel/react";
import { useRefresh } from "@/hooks/use-refresh";

interface NavbarProps {
    isCollapsed: boolean;
    onResetWidth: () => void;
}

const Navbar = ({
    isCollapsed,
    onResetWidth
}: NavbarProps) => {
    const params = useParams();
    const docStore = useDocStore();
    const actor = useActor();
    const documentKeys = useRefresh((s) => s.documentKeys);
    const [document, setDocument] = useState<Document | null | undefined>(undefined);
    const documentId = params.documentId as string;
    const refreshKey = documentKeys[documentId] || 0;

    useEffect(() => {
        if (documentId) {
            // alive 标志：快速切换文档时丢弃过期响应，避免旧文档覆盖新文档
            let alive = true;
            docStore.getById(actor, documentId)
                .then((doc) => { if (alive) setDocument(doc); })
                .catch(() => { if (alive) setDocument(null); });
            return () => { alive = false; };
        }
    }, [documentId, refreshKey, docStore, actor]);

    if (document === undefined) {
        // 骨架态与就绪态必须同一套盒模型/背景：换材质或换内边距会让首屏顶栏跳 10px
        return (
            <nav className="flex h-11 w-full shrink-0 items-center gap-x-2 px-3">
                <div className="flex items-center justify-between w-full">
                    <Title.Skeleton />
                    <div className="flex gap-x-2 items-center">
                        <Menu.Skeleton />
                    </div>
                </div>
            </nav>
        );
    }

    if (document === null) {
        return null;
    }

    return (
        <>
            <nav className="flex h-11 w-full shrink-0 items-center gap-x-2 px-3">
                {isCollapsed && (
                    <button
                        type="button"
                        onClick={onResetWidth}
                        aria-label="展开侧边栏"
                        title="展开侧边栏"
                        className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-control bg-transparent p-0 text-shell-label-secondary transition-colors hover:bg-shell-row-hover hover:text-shell-label-primary"
                    >
                        <MenuIcon className="h-4 w-4" aria-hidden="true" />
                    </button>
                )}
                <div className="flex items-center justify-between w-full">
                    <Title initialData={document} />
                    <div className="flex gap-x-2 items-center">
                        <Publish initialData={document}/>
                        <Menu documentId={document.id} isArchive={document.isArchived} />
                    </div>
                </div>
            </nav>
            {document.isArchived && (
                <Banner documentId={document.id} />
            )}
        </>
    );
};
export default Navbar;
