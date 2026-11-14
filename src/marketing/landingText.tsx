import { FolderTree, PenLine, Sparkles } from "@/components/icons";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";

// 特性区 + 收尾 CTA：Apple 产品页的三栏卡片（发丝边、柔和投影、hover 只抬升阴影、无位移），
// 图标底衬用系统蓝的 10% 染色，强调色全站只有系统蓝一种。
const features = [
    {
        icon: PenLine,
        title: "Write freely",
        description: "Nested pages, covers and icons keep your notes structured the way you think.",
    },
    {
        icon: Sparkles,
        title: "Ask your notes",
        description: "Chat with an AI assistant that reads your documents and answers with references.",
    },
    {
        icon: FolderTree,
        title: "Stay organized",
        description: "Search, archive and batch-manage — everything lives in one connected space.",
    },
];

const LandingText = () => {
    return (
        <section className="mx-auto w-full max-w-[1000px] py-6 md:py-10">
            <div className="mx-auto max-w-[680px] text-center">
                <h2 className="text-balance text-display font-bold leading-[1.1] tracking-[-0.025em] md:text-hero">
                    Built for the way you think.
                </h2>
                <p className="mt-4 text-body leading-[1.5] text-muted-foreground">
                    Notes, pages and an AI assistant — one calm, connected workspace.
                </p>
            </div>

            <div className="mt-12 grid gap-4 md:grid-cols-3">
                {features.map((f) => (
                    <div
                        key={f.title}
                        className="rounded-panel hairline border-border bg-card p-6 shadow-[var(--shadow-sm)] transition-shadow duration-150 hover:shadow-[var(--shadow-md)]"
                    >
                        <div className="mb-4 flex h-9 w-9 items-center justify-center rounded-card bg-primary/10 text-primary">
                            <f.icon className="h-4 w-4" strokeWidth={2} />
                        </div>
                        <h3 className="text-body font-semibold tracking-[-0.01em]">
                            {f.title}
                        </h3>
                        <p className="mt-1.5 text-lead leading-[1.5] text-muted-foreground">
                            {f.description}
                        </p>
                    </div>
                ))}
            </div>

            {/* 收尾 CTA */}
            <div className="mx-auto mt-16 max-w-[680px] rounded-sheet hairline border-border bg-card px-8 py-14 text-center shadow-[var(--shadow-sm)] md:py-20">
                <h2 className="text-balance text-display font-bold leading-[1.1] tracking-[-0.025em] md:text-hero">
                    Start writing with <span className="text-primary">your AI</span>.
                </h2>
                <p className="mt-4 text-body leading-[1.5] text-muted-foreground">
                    Free to start. No credit card required.
                </p>
                <div className="mt-8">
                    <Link to="/register">
                        <Button className="h-11 rounded-card px-6 text-lead font-medium active:scale-[0.98]">
                            Get Lotion Free!
                        </Button>
                    </Link>
                </div>
            </div>
        </section>
    );
}

export default LandingText;
