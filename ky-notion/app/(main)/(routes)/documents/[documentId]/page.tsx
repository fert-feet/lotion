"use client";

import { useQuery } from "convex/react";
import { Id } from "../../../../../convex/_generated/dataModel";
import { api } from "../../../../../convex/_generated/api";
import { Spinner } from "../../../../../components/ui/spinner";
import { useParams } from "next/navigation";
import Toolbar from "../../../../../components/toobar";
import Cover from "../../../_components/cover";

const DocumentIdPage = () => {
    const params = useParams();

    const document = useQuery(api.documents.getById, {
        documentId: params.documentId as Id<"documents">
    });

    if (document === undefined) {
        return (
            <div>
                <Spinner />
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
            </div>
        </div>
    );
};

export default DocumentIdPage;