"use client"

import { useConvexAuth } from "convex/react";
import { Spinner } from "../../components/ui/spinner";
import { redirect } from "next/navigation";
import Navigation from "./_components/navigation";

const MainLayout = ({
    children
}: { children: React.ReactNode }) => {
    const { isAuthenticated, isLoading } = useConvexAuth()

    if (isLoading) {
        return (
            <div className="items-center flex justify-center h-full">
                <Spinner className="size-10" />
            </div>
        )
    }

    if (!isAuthenticated) {
        return redirect("/")
    }

    if (isAuthenticated && !isLoading) {
        return (
            <div className="h-full flex dark:bg-[#1f1f1f]">
                <Navigation />
                <main className="flex-1 h-full justify-center items-center overflow-y-auto">
                    {children}
                </main>
            </div>
        );
    }

}

export default MainLayout;