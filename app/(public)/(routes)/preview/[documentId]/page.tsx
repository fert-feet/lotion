"use client";

// TODO 把这些相对位置改为 @ 开头的路径
import { useMutation, useQuery } from "convex/react";
import { Doc, Id } from "../../../../../convex/_generated/dataModel";
import { api } from "../../../../../convex/_generated/api";
import { Spinner } from "../../../../../components/ui/spinner";
import { useParams, useRouter } from "next/navigation";
import Toolbar from "../../../../../components/toobar";
import Cover from "../../../../(main)/_components/cover";
import { Skeleton } from "../../../../../components/ui/skeleton";
import { useMemo } from "react";
import dynamic from "next/dynamic";
import Image from "next/image";
import { Button } from "../../../../../components/ui/button";
import { ArrowRight } from "lucide-react";

const DocumentIdPage = () => {
    const params = useParams();

    //TODO 查询几个 use 的用法
    const Editor = useMemo(() => dynamic(() => import("../../../../(main)/_components/editor"), { ssr: false }), []);

    const document = useQuery(api.documents.getById, {
        documentId: params.documentId as Id<"documents">
    });

    const update = useMutation(api.documents.update);
    const router = useRouter()

    const onChange = (content: string) => {
        update({
            id: params.documentId as Id<"documents">,
            content
        });
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
            <div className="h-full flex flex-col items-center justify-center space-y-4">
                <div className="flex">
                    <Image
                        alt="error"
                        src="/logo.svg"
                        width={"300"}
                        height={"300"}
                    />
                </div>
                <h2 className="text-lg font-bold pt-4 text-center">
                    Only the author can view it!
                </h2>
            <Button onClick={() => router.push("/")} className="text-md font-medium cursor-pointer">
                Go back
                <ArrowRight className="h-5 w-5 ml-2" />
            </Button>
            </div>
        );

    }

    return (
        <div className="pb-40">
            <Cover preview url={document.coverImage} />
            <div className="md:max-w-3xl lg:max-w-4xl mx-auto">
                <Toolbar preview initialData={document} />
                <Editor
                    editable={false}
                    onChange={onChange}
                    initialContent={document.content}
                />
            </div>
        </div>
    );
};

export default DocumentIdPage;