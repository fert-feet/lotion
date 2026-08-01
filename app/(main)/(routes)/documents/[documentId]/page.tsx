"use client";

import { useEffect, useState, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { getById, getByIdFresh, update, type Document } from "@/lib/db";
import { useRefresh } from "@/hooks/use-refresh";
import { Skeleton } from "../../../../../components/ui/skeleton";
import { Button } from "../../../../../components/ui/button";
import { FileQuestion } from "lucide-react";
import Toolbar from "../../../../../components/toobar";
import Cover from "../../../_components/cover";

const DocumentIdPage = () => {
    const params = useParams();
    const router = useRouter();
    const Editor = useMemo(() => dynamic(() => import("../../../_components/editor"), { ssr: false }), []);
    const documentKeys = useRefresh((s) => s.documentKeys);

    const [document, setDocument] = useState<Document | null | undefined>(undefined);
    const documentId = params.documentId as string;
    const refreshKey = documentKeys[documentId] || 0;

    useEffect(() => {
        if (documentId) {
            // 首次加载走缓存；AI 修改标记（documentKeys 变化）后必须绕过缓存
            // 拿新内容（updateNote 在服务端直接写库，docCache 仍是旧值）
            const loader = refreshKey === 0 ? getById : getByIdFresh;
            loader(documentId)
                .then(setDocument)
                .catch(() => setDocument(null));
        }
    }, [documentId, refreshKey]);

    const onChange = (content: string) => {
        if (document) {
            update(document.id, { content });
        }
    };

    if (document === undefined) {
        return (
            <div>
                <Cover.Skeleton />
                <div className="md:max-w-3xl lg:max-w-4xl mx-auto mt-10">
                    <div className="space-y-4 pl-8 pt-4">
                        <Skeleton className="h-14 w-[50%]" />
                        <Skeleton className="h-14 w-[80%]" />
                        <Skeleton className="h-14 w-[40%]" />
                        <Skeleton className="h-14 w-[60%]" />
                    </div>
                </div>
            </div>
        );
    }

    if (document === null) {
        return (
            <div className="h-full flex flex-col items-center justify-center gap-3 text-center px-4">
                <FileQuestion className="h-12 w-12 text-muted-foreground" />
                <div>
                    <p className="text-base font-medium">文档不存在或已删除</p>
                    <p className="text-sm text-muted-foreground mt-1">它可能已被删除，或链接已失效</p>
                </div>
                <Button
                    variant="outline"
                    size="sm"
                    className="mt-2 cursor-pointer"
                    onClick={() => router.push("/documents")}
                >
                    返回文档列表
                </Button>
            </div>
        );
    }

    return (
        <div className="pb-40">
            <Cover url={document.coverImage || undefined} />
            <div className="md:max-w-3xl lg:max-w-4xl mx-auto">
                <Toolbar initialData={document} />
                <Editor
                    editable={!document.isArchived}
                    onChange={onChange}
                    initialContent={document.content || undefined}
                />
            </div>
        </div>
    );
};

export default DocumentIdPage;
