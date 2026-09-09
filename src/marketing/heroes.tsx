import { FileText, Sparkles } from "@/components/icons";

// 产品演示：一枚 macOS 窗口（14px 连续圆角 + 发丝边 + 柔和投影 + 交通灯），
// 左文档右 AI 对话。纯 CSS 构建，不再使用网格纸 / 荧光笔。
const roadmap = [
    "Launch the AI assistant for every note",
    "Ship the mobile app to iOS & Android",
    "Redesign onboarding for new teams",
    "Add nested pages and cross-note links",
];

const summary = [
    "1. Launch the AI assistant in every note",
    "2. Ship mobile apps on both platforms",
    "3. Redesign onboarding and add nesting",
];

const Heroes = () => {
    return (
        <section className="mx-auto w-full max-w-[1000px] py-6 md:py-10">
            <div className="overflow-hidden rounded-[14px] border-[0.5px] border-border bg-card shadow-[var(--shadow-md)]">
                {/* 窗口标题栏 */}
                <div className="flex h-10 items-center gap-2 border-b-[0.5px] border-border bg-[color-mix(in_srgb,var(--foreground)_4%,var(--background))] px-4">
                    <span className="h-[10px] w-[10px] rounded-full bg-destructive/75" />
                    <span className="h-[10px] w-[10px] rounded-full bg-ai/75" />
                    <span className="h-[10px] w-[10px] rounded-full bg-chart-2/75" />
                    <span className="ml-2 truncate text-[12px] font-medium text-shell-label-secondary">
                        Q3 Product Roadmap — Lotion
                    </span>
                    <span className="ml-auto hidden shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary sm:inline-flex">
                        <Sparkles className="h-3 w-3" strokeWidth={2} />
                        AI ready
                    </span>
                </div>

                <div className="grid md:grid-cols-5">
                    {/* 左：文档正文 */}
                    <div className="border-b-[0.5px] border-border p-6 md:col-span-3 md:border-b-0 md:border-r-[0.5px] md:p-8">
                        <div className="mb-4 flex items-center gap-2">
                            <span className="text-[17px]">🚀</span>
                            <span className="text-[17px] font-semibold tracking-[-0.01em]">
                                Q3 Product Roadmap
                            </span>
                        </div>
                        <p className="text-[13px] leading-[1.7] text-muted-foreground">
                            A three-month plan to bring the AI assistant to every
                            note in Lotion.
                        </p>
                        <ul className="mt-4 space-y-2">
                            {roadmap.map((item) => (
                                <li key={item} className="flex items-start gap-2.5 text-[13px] leading-[1.6]">
                                    <span className="mt-[7px] h-[5px] w-[5px] shrink-0 rounded-full bg-primary/50" />
                                    <span>{item}</span>
                                </li>
                            ))}
                        </ul>
                    </div>

                    {/* 右：AI 对话 */}
                    <div className="flex flex-col gap-3 bg-muted p-6 md:col-span-2 md:p-8">
                        <div className="ml-auto max-w-[88%] rounded-[12px] rounded-br-[4px] bg-primary px-3.5 py-2 text-[13px] leading-[1.5] text-primary-foreground">
                            Summarize this note in 3 bullets
                        </div>
                        <div className="max-w-[94%] rounded-[12px] rounded-bl-[4px] border-[0.5px] border-border bg-card px-3.5 py-3 shadow-[var(--shadow-sm)]">
                            <div className="mb-2 flex items-center gap-1.5">
                                <Sparkles className="h-3 w-3 text-primary" strokeWidth={2} />
                                <span className="text-[11px] font-medium text-shell-label-tertiary">
                                    AI · read 1 note
                                </span>
                            </div>
                            <ul className="space-y-1 text-[13px] leading-[1.6]">
                                {summary.map((line) => (
                                    <li key={line}>{line}</li>
                                ))}
                            </ul>
                        </div>
                        <div className="mt-auto flex items-center gap-1.5 pt-1 text-[11px] text-shell-label-tertiary">
                            <FileText className="h-3 w-3" strokeWidth={2} />
                            参考来源：Q3 Product Roadmap
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
}

export default Heroes;
