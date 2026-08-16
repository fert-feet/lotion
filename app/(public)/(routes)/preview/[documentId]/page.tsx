"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { getPublishedDocument, update, type Document } from "@/lib/db";
import { Skeleton } from "../../../../../components/ui/skeleton";
import { useMemo } from "react";
import dynamic from "next/dynamic";
import Image from "next/image";
import { Button } from "../../../../../components/ui/button";
import { ArrowRight } from "@/components/icons";
import Toolbar from "../../../../../components/toobar";
import Cover from "../../../../(main)/_components/cover";

// 公开预览（本地版降级为"仅本机访问"，见 app/api/public/documents/[documentId]/route.ts）：
// - 读取走无鉴权的公开端点，仅返回 isPublished=true 的文档
// - TODO(后期 D9)：上 Vercel 公网部署时需重新评估公开面（分享令牌/访问控制 + 图床迁移）
const DocumentIdPage = () => {
    const params = useParams();
    const router = useRouter();
    const Editor = useMemo(() => dynamic(() => import("../../../../(main)/_components/editor"), { ssr: false }), []);

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
                    <Image
                        alt="error"
                        src="/logo.svg"
                        width={"80"}
                        height={"80"}
                    />
                </div>
                <h2 className="font-display text-2xl font-semibold tracking-tight pt-4 text-center">
                    Only the author can view it!
                </h2>
                <p className="text-sm text-muted-foreground text-center max-w-xs">
                    这篇笔记尚未公开，作者发布后才能预览
                </p>
                <Button onClick={() => router.push("/")} className="text-md font-medium cursor-pointer bg-ai text-ai-foreground hover:bg-ai/90">
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
                <Editor
                    editable={false}
                    onChange={onChange}
                    initialContent={document.content || undefined}
                />
            </div>
        </div>
    );
};

export default DocumentIdPage;
