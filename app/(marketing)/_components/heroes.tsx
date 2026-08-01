import { FileText, PenLine, Sparkles } from "lucide-react";

// 产品演示卡：左侧文档 + 右侧 AI 对话，网格纸背景，纯 CSS 构建
const Heroes = () => {
    return (
        <div className="w-full max-w-4xl mx-auto">
            <div className="relative rounded-xl border border-border bg-card shadow-xl shadow-ink/5 overflow-hidden">
                {/* 窗口顶栏 */}
                <div className="flex items-center gap-3 border-b border-border bg-muted/60 px-4 py-2.5">
                    <div className="flex h-5 w-5 items-center justify-center rounded bg-ai text-ai-foreground">
                        <PenLine className="h-3 w-3" strokeWidth={2.5} />
                    </div>
                    <span className="text-xs font-medium text-muted-foreground truncate">
                        Q3 Product Roadmap
                    </span>
                    <div className="ml-auto flex items-center gap-1.5 text-muted-foreground">
                        <Sparkles className="h-3.5 w-3.5 text-ai" />
                        <span className="text-[10px] font-medium">AI ready</span>
                    </div>
                </div>

                <div className="graph-paper grid md:grid-cols-5">
                    {/* 左侧：文档内容 */}
                    <div className="md:col-span-3 border-b md:border-b-0 md:border-r border-border p-6 md:p-7">
                        <div className="flex items-center gap-2 mb-4">
                            <span className="text-lg">🚀</span>
                            <span className="font-display text-lg font-semibold tracking-tight">
                                Q3 Product Roadmap
                            </span>
                        </div>
                        <div className="space-y-2.5">
                            <p className="rounded bg-muted/70 px-2 py-1 text-xs text-muted-foreground">
                                Launch the <span className="hl-mark text-ink font-medium">AI assistant</span> for every note
                            </p>
                            <p className="rounded bg-muted/70 px-2 py-1 text-xs text-muted-foreground">
                                Ship the mobile app to iOS &amp; Android
                            </p>
                            <p className="rounded bg-muted/70 px-2 py-1 text-xs text-muted-foreground">
                                Redesign onboarding for new teams
                            </p>
                            <p className="rounded bg-muted/70 px-2 py-1 text-xs text-muted-foreground">
                                Add nested pages and cross-note links
                            </p>
                        </div>
                    </div>

                    {/* 右侧：AI 对话 */}
                    <div className="md:col-span-2 flex flex-col gap-3 p-6 md:p-7 bg-background/50">
                        <div className="ml-auto max-w-[85%] rounded-lg rounded-br-sm bg-foreground px-3 py-2 text-xs text-primary-foreground">
                            Summarize this note in 3 bullets
                        </div>
                        <div className="max-w-[92%] rounded-lg rounded-bl-sm border border-border bg-card px-3 py-2.5 shadow-sm">
                            <div className="mb-1.5 flex items-center gap-1.5">
                                <Sparkles className="h-3 w-3 text-ai" />
                                <span className="text-[10px] font-semibold text-muted-foreground">
                                    AI · read 1 note
                                </span>
                            </div>
                            <ul className="space-y-1 text-xs leading-relaxed text-foreground">
                                <li>1. Launch the AI assistant in every note</li>
                                <li>2. Ship mobile apps on both platforms</li>
                                <li>3. Redesign onboarding and add nesting</li>
                            </ul>
                        </div>
                        <div className="mt-auto flex items-center gap-1.5 pt-1 text-[10px] text-muted-foreground">
                            <FileText className="h-3 w-3" />
                            参考来源：Q3 Product Roadmap
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default Heroes;
