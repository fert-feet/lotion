import { FolderTree, PenLine, Sparkles } from "@/components/icons";
import Link from "next/link";
import { Button } from "../../../components/ui/button";

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
        <div className="w-full max-w-5xl mx-auto px-6 space-y-10">
            <div className="grid gap-4 md:grid-cols-3">
                {features.map((f) => (
                    <div
                        key={f.title}
                        className="group rounded-xl border border-border bg-card p-6 transition-colors hover:border-ink/25"
                    >
                        <div className="mb-4 flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-muted/60 text-foreground transition-colors group-hover:bg-ai group-hover:text-ai-foreground">
                            <f.icon className="h-4.5 w-4.5" strokeWidth={2} />
                        </div>
                        <h3 className="font-display text-lg font-semibold tracking-tight mb-1.5">
                            {f.title}
                        </h3>
                        <p className="text-sm leading-relaxed text-muted-foreground">
                            {f.description}
                        </p>
                    </div>
                ))}
            </div>

            {/* 收尾 CTA */}
            <div className="graph-paper rounded-xl border border-border bg-card px-6 py-10 text-center">
                <h3 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight mb-2">
                    Start writing with <span className="hl-mark">your AI</span>.
                </h3>
                <p className="text-sm text-muted-foreground mb-5">
                    Free to start. No credit card required.
                </p>
                <Link href="/register">
                    <Button className="bg-ai text-ai-foreground hover:bg-ai/90 shadow-md shadow-ai/20">
                        Get Lotion Free!
                    </Button>
                </Link>
            </div>
        </div>
    );
}

export default LandingText;
