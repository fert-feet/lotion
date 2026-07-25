"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { getById, update, type Document } from "@/lib/db";
import { Skeleton } from "../../../../../components/ui/skeleton";
import { useMemo } from "react";
import dynamic from "next/dynamic";
import Toolbar from "../../../../../components/toobar";
import Cover from "../../../_components/cover";

const DocumentIdPage = () => {
    const params = useParams();
    const Editor = useMemo(() => dynamic(() => import("../../../_components/editor"), { ssr: false }), []);

    const [document, setDocument] = useState<Document | null | undefined>(undefined);

    useEffect(() => {
        if (params.documentId) {
            getById(params.documentId as string)
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
