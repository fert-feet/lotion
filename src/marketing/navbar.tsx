"use client"

import useScrollTop from "@/hooks/use-scroll-top";
import { cn } from "@/lib/utils";
import Logo from "./logo";
import { Button } from "@/components/ui/button";
import { ModeToggle } from "@/components/lightButton";
import { useUser } from "@/hooks/use-user";
import { Link } from "react-router";
import { Skeleton } from "@/components/ui/skeleton";

// 顶部导航：macOS 工具栏语言——52px 高、半透明材质 + 背景模糊、底部发丝线，
// 没有荧光笔色条、没有厚重投影。按钮沿用系统 push button（小号）。
const Navbar = () => {
    const { user, loading } = useUser()
    const isAuthenticated = !!user
    const scrolled = useScrollTop()

    return (
        <header
            className={cn(
                "fixed top-0 z-50 flex h-[52px] w-full items-center px-5 md:px-8",
                "material-toolbar border-b-[0.5px] border-border",
                "transition-colors duration-150",
                scrolled && "shadow-[var(--shadow-sm)]",
            )}
        >
            <Logo />
            <nav className="ml-auto flex items-center gap-x-2">
                {loading && <Skeleton className="h-8 w-20 rounded-[7px]" />}
                {!isAuthenticated && !loading && (
                    <>
                        <Link to="/login">
                            <Button variant="ghost" className="cursor-pointer">Login</Button>
                        </Link>
                        <Link to="/register">
                            <Button className="cursor-pointer">Get Lotion free!</Button>
                        </Link>
                    </>
                )}
                {isAuthenticated && !loading && (
                    <Button asChild>
                        <Link to="/documents">
                            Enter Lotion
                        </Link>
                    </Button>
                )}
                <ModeToggle />
            </nav>
        </header>
    );
}

export default Navbar;
