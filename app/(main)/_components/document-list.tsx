"use client";

import { useParams, useRouter } from "next/navigation";
import { useState, useEffect, useMemo, useRef, useCallback } from "react";
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

    const onExpand = useCallback((documentId: string) => {
        setExpanded(prevExpanded => ({
            ...prevExpanded,
            [documentId]: !prevExpanded[documentId]
        }));
    }, []);

    const onRedirect = useCallback((documentId: string) => {
        router.push(`/documents/${documentId}`);
    }, [router]);

    // 稳定引用：每个文档的 onClick/onExpand 函数引用不变，React.memo 才能生效
    const clickHandlers = useRef<Record<string, () => void>>({});
    const expandHandlers = useRef<Record<string, () => void>>({});

    const getClickHandler = (docId: string) => {
        if (!clickHandlers.current[docId]) {
            clickHandlers.current[docId] = () => onRedirect(docId);
        }
        return clickHandlers.current[docId];
    };

    const getExpandHandler = (docId: string) => {
        if (!expandHandlers.current[docId]) {
            expandHandlers.current[docId] = () => onExpand(docId);
        }
        return expandHandlers.current[docId];
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
                        onClick={getClickHandler(document.id)}
                        label={document.title}
                        icon={FileIcon}
                        documentIcon={document.icon || undefined}
                        active={params.documentId === document.id}
                        level={level}
                        onExpand={getExpandHandler(document.id)}
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
    const initialLoaded = useRef(false);

    useEffect(() => {
        if (user) {
            getSidebarAll(user.id)
                .then((data) => {
                    setAllDocs(data);
                    initialLoaded.current = true;
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

    return <DocumentList allDocs={allDocs ?? []} />;
};

export default DocumentListRoot;
