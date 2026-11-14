"use client";

import { useEffect, useState, lazy, Suspense } from "react";
import { useNavigate, useParams } from "react-router";
import type { Document } from "@/lib/seams/doc-store";
import { useActor, useDocStore } from "@/src/kernel/react";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { ArrowRight, FileQuestion } from "@/components/icons";
import Toolbar from "@/components/toobar";
import Cover from "@/src/shell/cover";

// 编辑器按需加载：迁移自 next/dynamic({ ssr:false }) → React.lazy
const Editor = lazy(() => import("@/src/shell/editor"));

// 公开预览（本地版降级为"仅本机访问"，见 server/routes/public-documents.ts）：
// - 读取走无鉴权的公开端点，仅返回 isPublished=true 的文档
// - TODO(后期 D9)：公网部署时需重新评估公开面（分享令牌/访问控制 + 图床迁移）
const DocumentIdPage = () => {
  const docStore = useDocStore();
  const actor = useActor();
    const params = useParams();
    const navigate = useNavigate();

    const [document, setDocument] = useState<Document | null | undefined>(undefined);

    useEffect(() => {
        if (params.documentId) {
            docStore.getPublishedById(params.documentId as string)
                .then(setDocument)
                .catch(() => setDocument(null));
        }
    }, [params.documentId, docStore, actor]);

    const onChange = (content: string) => {
        if (document) {
            docStore.update(actor, document.id, { content });
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
            <div className="flex h-full items-center justify-center">
                <EmptyState
                    icon={<FileQuestion className="h-5 w-5" strokeWidth={1.5} />}
                    title="页面不存在"
                    action={
                        <Button variant="outline" size="sm" onClick={() => navigate("/")}>
                            返回
                        </Button>
                    }
                />
            </div>
        );
    }

    if (!document.isPublished) {
        return (
            <div className="flex h-full items-center justify-center">
                <EmptyState
                    icon={<img alt="" src="/logo.svg" width={20} height={20} />}
                    title="只有作者能查看全文"
                    description="这篇笔记尚未公开，作者发布后才能预览"
                    action={
                        <Button onClick={() => navigate("/")} className="cursor-pointer">
                            返回
                            <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                        </Button>
                    }
                />
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
