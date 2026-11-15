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
                "fixed top-0 z-chrome flex h-[52px] w-full items-center px-5 md:px-8",
                "material-toolbar hairline-b border-border",
                "transition-colors duration-150",
                scrolled && "shadow-elevation-1",
            )}
        >
            <Logo />
            <nav className="ml-auto flex items-center gap-x-2">
                {loading && <Skeleton className="h-8 w-20 rounded-control" />}
                {!isAuthenticated && !loading && (
                    <>
                        <Link to="/login">
                            <Button variant="ghost" className="hidden cursor-pointer sm:inline-flex">登录</Button>
                        </Link>
                        <Link to="/register">
                            <Button className="cursor-pointer">
                                <span className="sm:hidden">开始使用</span>
                                <span className="hidden sm:inline">免费开始使用</span>
                            </Button>
                        </Link>
                    </>
                )}
                {isAuthenticated && !loading && (
                    <Button asChild>
                        <Link to="/documents">
                            进入 Lotion
                        </Link>
                    </Button>
                )}
                <ModeToggle />
            </nav>
        </header>
    );
}

export default Navbar;
