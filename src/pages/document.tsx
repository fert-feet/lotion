"use client";

import { useEffect, useState, useCallback, useRef, lazy, Suspense } from "react";
import { useNavigate, useParams } from "react-router";
import type { Document } from "@/lib/seams/doc-store";
import { useActor, useDocStore } from "@/src/kernel/react";
import { useRefresh } from "@/hooks/use-refresh";
import { useDocumentAutosave } from "@/hooks/use-document-autosave";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { FileQuestion } from "@/components/icons";
import Toolbar from "@/components/toobar";
import Cover from "@/src/shell/cover";

// 编辑器按需加载（BlockNote 体积大）：迁移自 next/dynamic({ ssr:false }) → React.lazy
const Editor = lazy(() => import("@/src/shell/editor"));

// 正文停顿 800ms、标题停顿 400ms 后落库；切换文档或离开页面前由 hook 强制 flush。
const SAVE_DEBOUNCE_MS = 800;
const TITLE_SAVE_DEBOUNCE_MS = 400;

const DocumentIdPage = () => {
  const docStore = useDocStore();
  const actor = useActor();
    const params = useParams();
    const navigate = useNavigate();
    const documentKeys = useRefresh((s) => s.documentKeys);
    const triggerDocument = useRefresh((s) => s.triggerDocument);
    const triggerSidebar = useRefresh((s) => s.triggerSidebar);
    const documentId = params.documentId as string;

    const [document, setDocument] = useState<Document | null | undefined>(undefined);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [loadRevision, setLoadRevision] = useState(0);
    const loadedDocumentIdRef = useRef(documentId);
    const refreshKey = documentKeys[documentId] || 0;
    const contentAutosave = useDocumentAutosave({
        storageKey: `lotion:autosave:v1:${documentId}:content`,
        delay: SAVE_DEBOUNCE_MS,
        save: useCallback(
            (content: string) => docStore.update(actor, documentId, { content }),
            [actor, docStore, documentId],
        ),
    });
    const titleAutosave = useDocumentAutosave({
        storageKey: `lotion:autosave:v1:${documentId}:title`,
        delay: TITLE_SAVE_DEBOUNCE_MS,
        save: useCallback(
            async (title: string) => {
                await docStore.update(actor, documentId, { title });
                triggerSidebar();
                triggerDocument(documentId);
            },
            [actor, docStore, documentId, triggerDocument, triggerSidebar],
        ),
    });

    useEffect(() => {
        if (documentId) {
            // 首次加载走缓存；AI 修改标记（documentKeys 变化）后必须绕过缓存
            // 拿新内容（updateNote 在服务端直接写库，docCache 仍是旧值）。
            // alive 标志：快速切换文档时丢弃过期响应，避免旧文档覆盖新文档
            let alive = true;
            const fresh = refreshKey !== 0;
            if (loadedDocumentIdRef.current !== documentId) {
                loadedDocumentIdRef.current = documentId;
                setDocument(undefined);
            }
            setLoadError(null);
            docStore.getById(actor, documentId, { fresh })
                .then((doc) => {
                    if (!alive) return;
                    setDocument(doc);
                    setLoadError(null);
                })
                .catch((error: unknown) => {
                    if (!alive) return;
                    setDocument(null);
                    setLoadError(error instanceof Error ? error.message : "加载文档失败");
                });
            return () => { alive = false; };
        }
    }, [documentId, refreshKey, loadRevision, docStore, actor]);

    const onChange = useCallback((content: string) => {
        contentAutosave.schedule(content);
    }, [contentAutosave]);

    const onTitleChange = useCallback((title: string) => {
        const nextTitle = title || "未命名";
        setDocument((prev) => (prev ? { ...prev, title: nextTitle } : prev));
        titleAutosave.schedule(nextTitle);
    }, [titleAutosave]);

    const onTitleCommit = useCallback((title: string) => {
        const nextTitle = title || "未命名";
        setDocument((prev) => (prev ? { ...prev, title: nextTitle } : prev));
        titleAutosave.schedule(nextTitle);
        void titleAutosave.flush();
    }, [titleAutosave]);

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
        if (loadError) {
            return (
                <div className="flex h-full items-center justify-center">
                    <EmptyState
                        icon={<FileQuestion className="h-5 w-5" strokeWidth={1.5} />}
                        title="文档加载失败"
                        description={loadError}
                        action={
                            <div className="flex items-center gap-2">
                                <Button
                                    size="sm"
                                    onClick={() => {
                                        setDocument(undefined);
                                        setLoadRevision((value) => value + 1);
                                    }}
                                >
                                    重试
                                </Button>
                                <Button variant="outline" size="sm" onClick={() => navigate("/documents")}>
                                    返回文档列表
                                </Button>
                            </div>
                        }
                    />
                </div>
            );
        }
        return (
            <div className="flex h-full items-center justify-center">
                <EmptyState
                    icon={<FileQuestion className="h-5 w-5" strokeWidth={1.5} />}
                    title="文档不存在或已删除"
                    action={
                        <Button variant="outline" size="sm" className="cursor-pointer" onClick={() => navigate("/documents")}>
                            返回文档列表
                        </Button>
                    }
                />
            </div>
        );
    }

    const contentRecovery =
        contentAutosave.recovery !== null && contentAutosave.recovery !== document.content
            ? contentAutosave.recovery
            : null;
    const titleRecovery =
        titleAutosave.recovery !== null && titleAutosave.recovery !== document.title
            ? titleAutosave.recovery
            : null;
    const saveError = contentAutosave.error ?? titleAutosave.error;
    const saveStatus =
        saveError !== null
            ? "error"
            : contentAutosave.status === "saving" || titleAutosave.status === "saving"
              ? "saving"
              : contentAutosave.status === "saved" || titleAutosave.status === "saved"
                ? "saved"
                : "idle";

    const restoreRecovery = () => {
        if (contentRecovery !== null) {
            setDocument((prev) => (prev ? { ...prev, content: contentRecovery } : prev));
            contentAutosave.schedule(contentRecovery);
            void contentAutosave.flush();
        }
        if (titleRecovery !== null) {
            setDocument((prev) => (prev ? { ...prev, title: titleRecovery } : prev));
            titleAutosave.schedule(titleRecovery);
            void titleAutosave.flush();
        }
    };

    const discardRecovery = () => {
        contentAutosave.discardRecovery();
        titleAutosave.discardRecovery();
    };

    const retrySave = () => {
        void Promise.all([contentAutosave.retry(), titleAutosave.retry()]);
    };

    return (
        <div className="pb-40">
            {(saveStatus !== "idle" || contentRecovery !== null || titleRecovery !== null) && (
                <div
                    role={saveStatus === "error" ? "alert" : "status"}
                    aria-live="polite"
                    className="sticky top-0 z-chrome flex flex-wrap items-center gap-x-3 gap-y-1.5 hairline-b border-shell-border bg-background/92 px-4 py-1.5 text-ui-sm text-shell-label-secondary backdrop-blur"
                >
                    {saveStatus !== "idle" && (
                        <span className={saveStatus === "error" ? "text-destructive" : undefined}>
                            {saveStatus === "saving"
                                ? "正在保存…"
                                : saveStatus === "saved"
                                  ? "所有更改已保存"
                                  : `保存失败：${saveError ?? "请稍后重试"}`}
                        </span>
                    )}
                    {saveStatus === "error" && (
                        <button
                            type="button"
                            onClick={retrySave}
                            className="cursor-pointer font-medium text-primary hover:underline"
                        >
                            重试
                        </button>
                    )}
                    {(contentRecovery !== null || titleRecovery !== null) && (
                        <>
                            <span className="text-warning">发现本地未保存内容</span>
                            <button
                                type="button"
                                onClick={restoreRecovery}
                                className="cursor-pointer font-medium text-primary hover:underline"
                            >
                                恢复
                            </button>
                            <button
                                type="button"
                                onClick={discardRecovery}
                                className="cursor-pointer text-shell-label-tertiary hover:text-shell-label-primary"
                            >
                                忽略
                            </button>
                        </>
                    )}
                </div>
            )}
            <Cover url={document.coverImage || undefined} editable={!document.isArchived} />
            <div className="md:max-w-3xl lg:max-w-4xl mx-auto">
                <Toolbar
                    initialData={document}
                    title={document.title || "未命名"}
                    onTitleChange={onTitleChange}
                    onTitleCommit={onTitleCommit}
                />
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
