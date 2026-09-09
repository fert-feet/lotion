"use client";

import { useEffect, useState, useRef, useCallback, lazy, Suspense } from "react";
import { useNavigate, useParams } from "react-router";
import { getById, getByIdFresh, update, type Document } from "@/lib/db";
import { useRefresh } from "@/hooks/use-refresh";
import usePageWidth from "@/hooks/use-page-width";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { FileQuestion } from "@/components/icons";
import Toolbar from "@/components/toobar";
import Cover from "@/src/shell/cover";

// 编辑器按需加载（BlockNote 体积大）：迁移自 next/dynamic({ ssr:false }) → React.lazy
const Editor = lazy(() => import("@/src/shell/editor"));

// 编辑器写库防抖：击键期间不落库，停顿 800ms 或卸载时写一次。
// 之前每次编辑都 JSON.stringify 全量 + update()，打字快时请求堆积
const SAVE_DEBOUNCE_MS = 800;

const DocumentIdPage = () => {
    const params = useParams();
    const navigate = useNavigate();
    const documentKeys = useRefresh((s) => s.documentKeys);
    // 页面宽度（narrow/wide，对标 Notion；localStorage 持久化）
    const pageWidth = usePageWidth((s) => s.pageWidth);

    const [document, setDocument] = useState<Document | null | undefined>(undefined);
    const documentId = params.documentId as string;
    const refreshKey = documentKeys[documentId] || 0;

    // 防抖保存：latestContent 保存最新内容，timer 到期才写库；
    // documentId 存 ref，避免 onChange 闭包捕获过期值
    const latestContent = useRef("");
    const documentIdRef = useRef(documentId);
    const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    documentIdRef.current = documentId;

    // 切换文档时立即 flush 未保存内容（写回原文档）：
    // 防抖窗口内切到别的文档，内容不会丢失也不会串写到新文档。
    // cleanup 闭包捕获本次渲染的 documentId（旧值），documentIdRef 在
    // 渲染时已更新为最新值，不能用于这里。
    useEffect(() => {
        const prevDocId = documentId;
        return () => {
            if (prevDocId && latestContent.current) {
                if (saveTimer.current) {
                    clearTimeout(saveTimer.current);
                    saveTimer.current = undefined;
                }
                update(prevDocId, { content: latestContent.current });
                latestContent.current = "";
            }
        };
    }, [documentId]);

    useEffect(() => {
        if (documentId) {
            // 首次加载走缓存；AI 修改标记（documentKeys 变化）后必须绕过缓存
            // 拿新内容（updateNote 在服务端直接写库，docCache 仍是旧值）。
            // alive 标志：快速切换文档时丢弃过期响应，避免旧文档覆盖新文档
            let alive = true;
            const loader = refreshKey === 0 ? getById : getByIdFresh;
            loader(documentId)
                .then((doc) => { if (alive) setDocument(doc); })
                .catch(() => { if (alive) setDocument(null); });
            return () => { alive = false; };
        }
    }, [documentId, refreshKey]);

    // 卸载时 flush 最后一次未保存的编辑，防止防抖窗口内离开丢内容
    useEffect(() => {
        return () => {
            if (saveTimer.current) clearTimeout(saveTimer.current);
            if (latestContent.current && documentIdRef.current) {
                update(documentIdRef.current, { content: latestContent.current });
            }
        };
    }, []);

    const onChange = useCallback((content: string) => {
        latestContent.current = content;
        // 快照 timer 创建时的文档 id：到期后若已切换文档，内容仍写回原文档，杜绝串写
        const docId = documentIdRef.current;
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => {
            saveTimer.current = undefined;
            if (docId) {
                update(docId, { content });
            }
        }, SAVE_DEBOUNCE_MS);
    }, []);

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
                    onClick={() => navigate("/documents")}
                >
                    返回文档列表
                </Button>
            </div>
        );
    }

    return (
        <div className="pb-40">
            <Cover url={document.coverImage || undefined} />
            <div
                className={
                    pageWidth === "wide"
                        ? "md:max-w-5xl lg:max-w-6xl mx-auto"
                        : "md:max-w-3xl lg:max-w-4xl mx-auto"
                }
            >
                <Toolbar initialData={document} />
                <Suspense fallback={<EditorFallback />}>
                    <Editor
                        editable={!document.isArchived}
                        onChange={onChange}
                        initialContent={document.content || undefined}
                    />
                </Suspense>
            </div>
        </div>
    );
};

/** 编辑器 chunk 加载中（Skeleton 与文档加载态保持一致的观感） */
const EditorFallback = () => (
    <div className="md:max-w-3xl lg:max-w-4xl mx-auto mt-10">
        <div className="space-y-4 pl-8 pt-4">
            <Skeleton className="h-14 w-[50%]" />
            <Skeleton className="h-14 w-[80%]" />
            <Skeleton className="h-14 w-[40%]" />
        </div>
    </div>
);

export default DocumentIdPage;
