"use client"

import useScrollTop from "@/hooks/use-scroll-top";
import { cn } from "../../../lib/utils";
import Logo from "./logo";
import { Button } from "../../../components/ui/button";
import { ModeToggle } from "../../../components/lightButton";
import { useSupabaseUser } from "@/hooks/use-supabase-user";
import Link from "next/link";
import { Skeleton } from "../../../components/ui/skeleton";

const Navbar = () => {
    const { user, loading } = useSupabaseUser()
    const isAuthenticated = !!user
    const scrolled = useScrollTop()

    return (
        <div className={cn("z-50 bg-background dark:bg-[#1f1f1f] fixed top-0 flex items-center w-full p-6", scrolled && "border-b shadow-sm")}>
            <Logo />
            <div className="flex md:ml-auto md:justify-end justify-between w-full items-center gap-x-2">
                {loading && (
                    <Button variant="default" disabled>
                        <Skeleton className="h-4 w-16" />
                    </Button>
                )}
                {!isAuthenticated && !loading && (
                    <>
                        <Link href="/login">
                            <Button variant="ghost" className="cursor-pointer">Login</Button>
                        </Link>
                        <Link href="/register">
                            <Button variant="default">Get Lotion free!</Button>
                        </Link>
                    </>
                )}
                {isAuthenticated && !loading && (
                    <>
                        <Button variant="default" size="sm" asChild>
                            <Link href="/documents">
                                Enter Lotion
                            </Link>
                        </Button>
                    </>
                )}
                <ModeToggle />
            </div>
        </div>
    );
}

export default Navbar;
