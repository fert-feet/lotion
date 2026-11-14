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
            <div className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1 text-ui font-medium text-muted-foreground">
                <Sparkles className="h-3.5 w-3.5 text-primary" strokeWidth={2} />
                每篇笔记里都住着一个 AI 助手
            </div>
            <h1 className="mt-6 text-balance text-hero font-bold leading-[1.05] tracking-[-0.03em] md:text-hero">
                会<span className="text-primary">思考</span>的笔记
            </h1>
            <p className="mx-auto mt-5 max-w-[560px] text-body leading-[1.5] text-muted-foreground md:text-title">
                Lotion 是一个连通的工作空间：AI 助手帮你写、总结、整理笔记——用你自己的语言。
            </p>
            {loading && (
                <div className="mt-8 flex justify-center">
                    <Spinner className="size-7" />
                </div>
            )}
            {!isAuthenticated && !loading && (
                <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
                    <Link to="/register">
                        <Button className="h-11 rounded-card px-6 text-lead font-medium active:scale-[0.98]">
                            免费开始使用
                        </Button>
                    </Link>
                    <Link to="/login">
                        <Button variant="secondary" className="h-11 rounded-card px-6 text-lead font-medium active:scale-[0.98]">
                            登录
                        </Button>
                    </Link>
                </div>
            )}
            {isAuthenticated && !loading && (
                <div className="mt-8">
                    <Button asChild className="h-11 rounded-card px-6 text-lead font-medium active:scale-[0.98]">
                        <Link to="/documents">
                            进入 Lotion
                            <ArrowRight className="ml-1 h-4 w-4" strokeWidth={2} />
                        </Link>
                    </Button>
                </div>
            )}
        </section>
    );
}

export default Heading;
