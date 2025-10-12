"use client";

import { useConvexAuth } from "convex/react";
import { Spinner } from "../../components/ui/spinner";
import { redirect } from "next/navigation";
import Navigation from "./_components/navigation";
import SearchCommand from "../../components/search-command";
import SettingsModal from "../../components/modals/settings-modal";

const MainLayout = ({
    children
}: { children: React.ReactNode; }) => {
    const { isAuthenticated, isLoading } = useConvexAuth();

    if (isLoading) {
        return (
            <div className="items-center flex justify-center h-full">
                <Spinner className="size-10" />
            </div>
        );
    }

    if (!isAuthenticated) {
        return redirect("/");
    }

    if (isAuthenticated && !isLoading) {
        return (
            <div className="h-full flex dark:bg-[#1f1f1f]">
                <Navigation />
                <main className="flex-1 h-full overflow-y-auto">
                    <SearchCommand />
                    {children}
                </main>
            </div>
        );
    }

};

export default MainLayout;