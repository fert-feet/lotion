"use client"

import useScrollTop from "@/hooks/use-scroll-top";
import { cn } from "@/lib/utils";
import Logo from "./logo";
import { Button } from "@/components/ui/button";
import { ModeToggle } from "@/components/lightButton";
import { useUser } from "@/hooks/use-user";
import { Link } from "react-router";
import { Skeleton } from "@/components/ui/skeleton";

const Navbar = () => {
    const { user, loading } = useUser()
    const isAuthenticated = !!user
    const scrolled = useScrollTop()

    return (
        <div className={cn(
            "z-50 fixed top-0 flex items-center w-full px-6 py-4",
            // 签名：顶部一条荧光笔黄细线
            "before:absolute before:top-0 before:left-0 before:h-[3px] before:w-full before:bg-ai",
            scrolled && "border-b border-border bg-background/80 backdrop-blur-md"
        )}>
            <Logo />
            <div className="flex md:ml-auto md:justify-end justify-between w-full items-center gap-x-2">
                {loading && (
                    <Button variant="default" disabled>
                        <Skeleton className="h-4 w-16" />
                    </Button>
                )}
                {!isAuthenticated && !loading && (
                    <>
                        <Link to="/login">
                            <Button variant="ghost" className="cursor-pointer">Login</Button>
                        </Link>
                        <Link to="/register">
                            <Button className="cursor-pointer bg-ai text-ai-foreground hover:bg-ai/90 shadow-sm">
                                Get Lotion free!
                            </Button>
                        </Link>
                    </>
                )}
                {isAuthenticated && !loading && (
                    <>
                        <Button variant="default" size="sm" asChild>
                            <Link to="/documents">
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
