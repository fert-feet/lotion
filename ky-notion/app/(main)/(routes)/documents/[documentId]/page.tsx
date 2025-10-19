"use client";

import { useMutation, useQuery } from "convex/react";
import { Doc, Id } from "../../../../../convex/_generated/dataModel";
import { api } from "../../../../../convex/_generated/api";
import { Spinner } from "../../../../../components/ui/spinner";
import { useParams } from "next/navigation";
import Toolbar from "../../../../../components/toobar";
import Cover from "../../../_components/cover";
import { Skeleton } from "../../../../../components/ui/skeleton";
import { useMemo } from "react";
import dynamic from "next/dynamic";

const DocumentIdPage = () => {
    const params = useParams();

    //TODO 查询几个 use 的用法
    const Editor = useMemo(() => dynamic(() => import("../../../_components/editor"), {ssr: false}), [])

    const document = useQuery(api.documents.getById, {
        documentId: params.documentId as Id<"documents">
    });

    const update = useMutation(api.documents.update)

    const onChange = (content: string) => {
        update({
            id: params.documentId as Id<"documents">,
            content
        })
    }

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
            <Cover url={document.coverImage} />
            <div className="md:max-w-3xl lg:max-w-4xl mx-auto">
                <Toolbar initialData={document} />
                <Editor
                editable={!document.isArchived}
                onChange={onChange}
                initialContent={document.content}
                />
            </div>
        </div>
    );
};

export default DocumentIdPage;