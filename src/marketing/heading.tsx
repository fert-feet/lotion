"use client"

import { Button } from "@/components/ui/button";
import { useUser } from "@/hooks/use-user";
import { ArrowRight, Sparkles } from "@/components/icons";
import { Spinner } from "@/components/ui/spinner";
import { Link } from "react-router";

// 首屏：Apple 产品页排版——小标签（克制灰底，无荧光笔）→ 56px 紧字距大标题
// → 19px 副标题 → 两个 push button（主：系统蓝 / 次：填充灰）。
const Heading = () => {
    const { user, loading } = useUser()
    const isAuthenticated = !!user

    return (
        <section className="mx-auto w-full max-w-[680px] py-6 text-center md:py-10">
            <div className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1 text-[13px] font-medium text-muted-foreground">
                <Sparkles className="h-3.5 w-3.5 text-primary" strokeWidth={2} />
                An AI assistant lives inside every note
            </div>
            <h1 className="mt-6 text-balance text-[44px] font-bold leading-[1.05] tracking-[-0.03em] md:text-[56px]">
                The notebook that <span className="text-primary">thinks</span> with you.
            </h1>
            <p className="mx-auto mt-5 max-w-[560px] text-[17px] leading-[1.5] text-muted-foreground md:text-[19px]">
                Lotion is the connected workspace where an AI assistant writes,
                summarizes and organizes your notes — in your language.
            </p>
            {loading && (
                <div className="mt-8 flex justify-center">
                    <Spinner className="size-7" />
                </div>
            )}
            {!isAuthenticated && !loading && (
                <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
                    <Link to="/register">
                        <Button className="h-11 rounded-[10px] px-6 text-[15px] font-medium active:scale-[0.98]">
                            Get Lotion Free!
                        </Button>
                    </Link>
                    <Link to="/login">
                        <Button variant="secondary" className="h-11 rounded-[10px] px-6 text-[15px] font-medium active:scale-[0.98]">
                            Login
                        </Button>
                    </Link>
                </div>
            )}
            {isAuthenticated && !loading && (
                <div className="mt-8">
                    <Button asChild className="h-11 rounded-[10px] px-6 text-[15px] font-medium active:scale-[0.98]">
                        <Link to="/documents">
                            Enter Lotion
                            <ArrowRight className="ml-1 h-4 w-4" strokeWidth={2} />
                        </Link>
                    </Button>
                </div>
            )}
        </section>
    );
}

export default Heading;
