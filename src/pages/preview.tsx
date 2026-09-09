"use client";

import { useEffect, useState, lazy, Suspense } from "react";
import { useNavigate, useParams } from "react-router";
import { getPublishedDocument, update, type Document } from "@/lib/db";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "@/components/icons";
import Toolbar from "@/components/toobar";
import Cover from "@/src/shell/cover";

// 编辑器按需加载：迁移自 next/dynamic({ ssr:false }) → React.lazy
const Editor = lazy(() => import("@/src/shell/editor"));

// 公开预览（本地版降级为"仅本机访问"，见 server/routes/public-documents.ts）：
// - 读取走无鉴权的公开端点，仅返回 isPublished=true 的文档
// - TODO(后期 D9)：公网部署时需重新评估公开面（分享令牌/访问控制 + 图床迁移）
const DocumentIdPage = () => {
    const params = useParams();
    const navigate = useNavigate();

    const [document, setDocument] = useState<Document | null | undefined>(undefined);

    useEffect(() => {
        if (params.documentId) {
            getPublishedDocument(params.documentId as string)
                .then(setDocument)
                .catch(() => setDocument(null));
        }
    }, [params.documentId]);

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
        return <div>Not found</div>;
    }

    if (!document.isPublished) {
        return (
            <div className="h-full flex flex-col items-center justify-center space-y-4 px-6">
                <div className="graph-paper flex h-40 w-40 items-center justify-center rounded-xl border border-border bg-card shadow-md shadow-ink/5">
                    <img alt="error" src="/logo.svg" width={80} height={80} />
                </div>
                <h2 className="font-display text-2xl font-semibold tracking-tight pt-4 text-center">
                    Only the author can view it!
                </h2>
                <p className="text-sm text-muted-foreground text-center max-w-xs">
                    这篇笔记尚未公开，作者发布后才能预览
                </p>
                <Button onClick={() => navigate("/")} className="text-md font-medium cursor-pointer bg-ai text-ai-foreground hover:bg-ai/90">
                    Go back
                    <ArrowRight className="h-5 w-5 ml-2" />
                </Button>
            </div>
        );
    }

    return (
        <div className="pb-40">
            <Cover preview url={document.coverImage || undefined} />
            <div className="md:max-w-3xl lg:max-w-4xl mx-auto">
                <Toolbar preview initialData={document} />
                <Suspense fallback={<Skeleton className="h-14 w-[60%] mt-10 ml-8" />}>
                    <Editor
                        editable={false}
                        onChange={onChange}
                        initialContent={document.content || undefined}
                    />
                </Suspense>
            </div>
        </div>
    );
};

export default DocumentIdPage;
