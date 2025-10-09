"use client"

import useScrollTop from "@/hooks/use-scroll-top";
import { cn } from "../../../lib/utils";
import Logo from "./logo";
import { Button } from "../../../components/ui/button";
import { ModeToggle } from "../../../components/lightButton";
import { useConvexAuth } from "convex/react";
import { SignInButton, UserButton } from "@clerk/nextjs";
import { Spinner } from "../../../components/ui/spinner";
import Link from "next/link";

const Navbar = () => {
    const { isAuthenticated, isLoading } = useConvexAuth()
    const scrolled = useScrollTop()

    return (
        // scrolled 的时候会添加底部边框和小尺寸阴影
        <div className={cn("z-50 bg-background dark:bg-[#1f1f1f] fixed top-0 flex items-center w-full p-6", scrolled && "border-b shadow-sm")}>
            <Logo />
            <div className="flex md:ml-auto md:justify-end justify-between w-full items-center gap-x-2">
                {isLoading && (
                    <Button variant="default" disabled>
                        <Spinner />
                        Loading...
                    </Button>
                )}
                {!isAuthenticated && !isLoading && (
                    <>
                        <SignInButton mode="modal">
                            <Button variant="ghost" className="cursor-pointer">Login</Button>
                        </SignInButton>
                        <SignInButton mode="modal">
                            <Button variant="default">Get Lotion free!</Button>
                        </SignInButton>
                    </>
                )}
                {isAuthenticated && !isLoading && (
                    <>
                        <Button variant="default" size="sm" asChild>
                            <Link href="/documents">
                                Enter Lotion
                            </Link>
                        </Button>
                        <UserButton afterSwitchSessionUrl="/" />
                    </>
                )}
                <ModeToggle />
            </div>
        </div>
    );
}


export default Navbar;