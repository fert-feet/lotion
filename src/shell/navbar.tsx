"use client";

import { useParams } from "react-router";
import { MenuIcon } from "@/components/icons";
import Title from "./title";
import Banner from "./banner";
import DraftBanner from "./draft-banner";
import Menu from "./menu";
import Publish from "./publish";
import { useEffect, useState } from "react";
import { getById, type Document } from "@/lib/db";
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
    const documentKeys = useRefresh((s) => s.documentKeys);
    const [document, setDocument] = useState<Document | null | undefined>(undefined);
    const documentId = params.documentId as string;
    const refreshKey = documentKeys[documentId] || 0;

    useEffect(() => {
        if (documentId) {
            // alive 标志：快速切换文档时丢弃过期响应，避免旧文档覆盖新文档
            let alive = true;
            getById(documentId)
                .then((doc) => { if (alive) setDocument(doc); })
                .catch(() => { if (alive) setDocument(null); });
            return () => { alive = false; };
        }
    }, [documentId, refreshKey]);

    if (document === undefined) {
        return (
            <nav className="material-toolbar flex w-full shrink-0 items-center gap-x-2 border-b-[0.5px] border-shell-border px-2 py-1.5">
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
            <nav className="flex w-full shrink-0 items-center gap-x-4 bg-background px-3 py-2">
                {isCollapsed && (
                    <MenuIcon
                        role="button"
                        onClick={onResetWidth}
                        className="h-4 w-4 text-shell-label-secondary"
                    />
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
            {document.isDraft && (
                <DraftBanner documentId={document.id} />
            )}
        </>
    );
};
export default Navbar;
