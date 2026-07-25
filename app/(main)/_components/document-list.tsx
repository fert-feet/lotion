"use client";

import { useParams, useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { useSupabaseUser } from "@/hooks/use-supabase-user";
import { useRefresh } from "@/hooks/use-refresh";
import { getSidebar, type Document } from "@/lib/db";
import Item from "./item";
import { cn } from "../../../lib/utils";
import { FileIcon } from "lucide-react";

interface DocumentListProps {
    parentDocumentId?: string | null;
    level?: number;
    data?: Document[];
}

const DocumentList = ({
    parentDocumentId,
    level = 0
}: DocumentListProps) => {
    const params = useParams();
    const router = useRouter();
    const { user } = useSupabaseUser();
    const { key: refreshKey } = useRefresh();
    const [expanded, setExpanded] = useState<Record<string, boolean>>({});
    const [documents, setDocuments] = useState<Document[] | undefined>(undefined);

    useEffect(() => {
        if (user) {
            getSidebar(user.id, parentDocumentId)
                .then(setDocuments)
                .catch(() => setDocuments([]));
        }
    }, [user, parentDocumentId, refreshKey]);

    const onExpand = (documentId: string) => {
        setExpanded(prevExpanded => ({
            ...prevExpanded,
            [documentId]: !prevExpanded[documentId]
        }));
    };

    const onRedirect = (documentId: string) => {
        router.push(`/documents/${documentId}`);
    };

    if (documents === undefined) {
        return (
            <>
                <Item.Skeleton level={level} />
                {level === 0 && (
                    <>
                        <Item.Skeleton level={level} />
                        <Item.Skeleton level={level} />
                    </>
                )}
            </>
        );
    }

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
                        />
                    )}
                </div>
            ))}
        </>
    );
};

export default DocumentList;
