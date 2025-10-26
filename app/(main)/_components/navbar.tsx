"use client";

import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useParams } from "next/navigation";
import { Id } from "../../../convex/_generated/dataModel";
import { MenuIcon } from "lucide-react";
import { Spinner } from "../../../components/ui/spinner";
import Title from "./title";
import Banner from "./banner";
import Menu from "./menu";
import Publish from "./publish";

interface NavbarProps {
    isCollapsed: boolean;
    onResetWidth: () => void;
}

const Navbar = ({
    isCollapsed,
    onResetWidth
}: NavbarProps) => {
    const params = useParams();

    const document = useQuery(api.documents.getById, {
        documentId: params.documentId as Id<"documents">
    });

    if (document === undefined) {
        return (
            <nav className="flex bg-background dark:bg-[#1f1f1f] px-3 py-2 w-full items-center gap-x-4">
                <div className="flex items-center justify-between w-full">
                    <Title.Skeleton />
                    <div className="flex gap-x-2 items-center">
                        <Menu.Skeleton />
                    </div>
                </div>
            </nav>
        );
    }

    if (document === null) {
        return null;
    }

    return (
        <>
            <nav className="flex bg-background dark:bg-[#1f1f1f] px-3 py-2 w-full items-center gap-x-4">
                {isCollapsed && (
                    <MenuIcon
                        role="button"
                        onClick={onResetWidth}
                        className="h-6 w-6 text-muted-foreground"
                    />
                )}
                <div className="flex items-center justify-between w-full">
                    <Title initialData={document} />
                    <div className="flex gap-x-2 items-center">
                        <Publish initialData={document}/>
                        <Menu documentId={document._id} isArchive={document.isArchived} />
                    </div>
                </div>
            </nav>
            {document.isArchived && (
                <Banner documentId={document._id} />
            )}
        </>
    );
};
export default Navbar;