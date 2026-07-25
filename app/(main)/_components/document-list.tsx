"use client";

import { useParams, useRouter } from "next/navigation";
import { useState, useEffect, useMemo, useRef } from "react";
import { useSupabaseUser } from "@/hooks/use-supabase-user";
import { useRefresh } from "@/hooks/use-refresh";
import { getSidebarAll, type SidebarDocument } from "@/lib/db";
import Item from "./item";
import { cn } from "../../../lib/utils";
import { FileIcon } from "lucide-react";

interface DocumentListProps {
    parentDocumentId?: string | null;
    level?: number;
    allDocs: SidebarDocument[];
}

const DocumentList = ({
    parentDocumentId,
    level = 0,
    allDocs,
}: DocumentListProps) => {
    const params = useParams();
    const router = useRouter();
    const [expanded, setExpanded] = useState<Record<string, boolean>>({});

    // 从扁平数组中过滤当前层级的子文档
    const documents = useMemo(() => {
        return allDocs.filter((d) => {
            if (parentDocumentId) return d.parentDocument === parentDocumentId;
            return d.parentDocument === null || d.parentDocument === undefined;
        });
    }, [allDocs, parentDocumentId]);

    const onExpand = (documentId: string) => {
        setExpanded(prevExpanded => ({
            ...prevExpanded,
            [documentId]: !prevExpanded[documentId]
        }));
    };

    const onRedirect = (documentId: string) => {
        router.push(`/documents/${documentId}`);
    };

    return (
        <>
            <p
                style={{
                    paddingLeft: level ? `${(level * 12) + 25}px` : undefined
                }}
                className={cn(
                    "hidden text-sm font-medium text-muted-foreground/80",
                    expanded && "last:block",
                    level === 0 && "hidden"
                )}
            >
                No page inside
            </p>
            {documents.map((document) => (
                <div key={document.id}>
                    <Item
                        id={document.id}
                        onClick={() => onRedirect(document.id)}
                        label={document.title}
                        icon={FileIcon}
                        documentIcon={document.icon || undefined}
                        active={params.documentId === document.id}
                        level={level}
                        onExpand={() => onExpand(document.id)}
                        expanded={expanded[document.id]}
                    />
                    {expanded[document.id] && (
                        <DocumentList
                            parentDocumentId={document.id}
                            level={level + 1}
                            allDocs={allDocs}
                        />
                    )}
                </div>
            ))}
        </>
    );
};

/**
 * 顶层包装组件：负责拉取数据并传给递归 DocumentList
 */
const DocumentListRoot = () => {
    const { user } = useSupabaseUser();
    const sidebarKey = useRefresh((s) => s.sidebarKey);
    const [allDocs, setAllDocs] = useState<SidebarDocument[] | undefined>(undefined);
    const [visible, setVisible] = useState(false);
    const initialLoaded = useRef(false);

    useEffect(() => {
        if (user) {
            setVisible(false);
            getSidebarAll(user.id)
                .then((data) => {
                    setAllDocs(data);
                    initialLoaded.current = true;
                    // 下一帧整体淡入，避免浏览器逐条绘制
                    requestAnimationFrame(() => setVisible(true));
                })
                .catch(() => {
                    if (!initialLoaded.current) setAllDocs([]);
                });
        }
    }, [user, sidebarKey]);

    if (!initialLoaded.current && allDocs === undefined) {
        return (
            <div className="px-3 py-2 space-y-1.5">
                <div className="h-4 w-3/4 rounded bg-neutral-200 dark:bg-neutral-700 animate-pulse" />
                <div className="h-4 w-1/2 rounded bg-neutral-200 dark:bg-neutral-700 animate-pulse" />
                <div className="h-4 w-2/3 rounded bg-neutral-200 dark:bg-neutral-700 animate-pulse" />
            </div>
        );
    }

    return (
        <div
            className="transition-opacity duration-150"
            style={{ opacity: visible ? 1 : 0 }}
        >
            <DocumentList allDocs={allDocs ?? []} />
        </div>
    );
};

export default DocumentListRoot;
