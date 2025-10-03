"use client"

import useScrollTop from "@/hooks/use-scroll-top";
import { cn } from "../../../lib/utils";
import Logo from "./logo";
import { Button } from "../../../components/ui/button";
import { ModeToggle } from "../../../components/lightButton";

const Navbar = () => {
    const scrolled = useScrollTop()

    return (
        // scrolled 的时候会添加底部边框和小尺寸阴影
        <div className={cn("z-50 bg-background dark:bg-[#1f1f1f] fixed top-0 flex items-center w-full p-6", scrolled && "border-b shadow-sm")}>
            <Logo />
            <div className="flex md:ml-auto md:justify-end justify-between w-full items-center gap-x-2">
                <ModeToggle />
                <Button variant="secondary">Login</Button>
            </div>
        </div>
    );
}
             

export default Navbar;