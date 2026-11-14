import { FileText, Sparkles } from "@/components/icons";

// 产品演示：一枚 macOS 窗口（14px 连续圆角 + 发丝边 + 柔和投影 + 交通灯），
// 左文档右 AI 对话。纯 CSS 构建，不再使用网格纸 / 荧光笔。
const roadmap = [
    "为每篇笔记上线 AI 助手",
    "移动端在 iOS 与 Android 上线",
    "为新团队重做引导流程",
    "加入嵌套页面与跨笔记链接",
];

const summary = [
    "1. 每篇笔记都内置 AI 助手",
    "2. 双平台上线移动端应用",
    "3. 重做引导流程并支持嵌套",
];

const Heroes = () => {
    return (
        <section className="mx-auto w-full max-w-[1000px] py-6 md:py-10">
            <div className="overflow-hidden rounded-panel hairline border-border bg-card shadow-elevation-2">
                {/* 窗口标题栏 */}
                <div className="flex h-10 items-center gap-2 hairline-b border-border bg-[color-mix(in_srgb,var(--foreground)_4%,var(--background))] px-4">
                    <span className="h-[10px] w-[10px] rounded-full bg-destructive/75" />
                    <span className="h-[10px] w-[10px] rounded-full bg-ai/75" />
                    <span className="h-[10px] w-[10px] rounded-full bg-chart-2/75" />
                    <span className="ml-2 truncate text-ui-sm font-medium text-shell-label-secondary">
                        Q3 产品路线图 —— Lotion
                    </span>
                    <span className="ml-auto hidden shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-primary/10 px-2 py-0.5 text-caption font-medium text-primary sm:inline-flex">
                        <Sparkles className="h-3 w-3" strokeWidth={2} />
                        AI 就绪
                    </span>
                </div>

                <div className="grid md:grid-cols-5">
                    {/* 左：文档正文 */}
                    <div className="hairline-b border-border p-6 md:col-span-3 md:border-b-0 md:hairline-r md:p-8">
                        <div className="mb-4 flex items-center gap-2">
                            <span className="text-body">🚀</span>
                            <span className="text-body font-semibold tracking-[-0.01em]">
                                Q3 产品路线图
                            </span>
                        </div>
                        <p className="text-ui leading-[1.7] text-muted-foreground">
                            三个月的计划：让 Lotion 的每篇笔记都有 AI 助手。
                        </p>
                        <ul className="mt-4 space-y-2">
                            {roadmap.map((item) => (
                                <li key={item} className="flex items-start gap-2.5 text-ui leading-[1.6]">
                                    <span className="mt-[7px] h-[5px] w-[5px] shrink-0 rounded-full bg-primary/50" />
                                    <span>{item}</span>
                                </li>
                            ))}
                        </ul>
                    </div>

                    {/* 右：AI 对话 */}
                    <div className="flex flex-col gap-3 bg-muted p-6 md:col-span-2 md:p-8">
                        <div className="ml-auto max-w-[88%] rounded-panel rounded-br-control bg-primary px-3.5 py-2 text-ui leading-[1.5] text-primary-foreground">
                            用三条要点总结这篇笔记
                        </div>
                        <div className="max-w-[94%] rounded-panel rounded-bl-control hairline border-border bg-card px-3.5 py-3 shadow-elevation-1">
                            <div className="mb-2 flex items-center gap-1.5">
                                <Sparkles className="h-3 w-3 text-primary" strokeWidth={2} />
                                <span className="text-caption font-medium text-shell-label-tertiary">
                                    AI · 读了 1 篇笔记
                                </span>
                            </div>
                            <ul className="space-y-1 text-ui leading-[1.6]">
                                {summary.map((line) => (
                                    <li key={line}>{line}</li>
                                ))}
                            </ul>
                        </div>
                        <div className="mt-auto flex items-center gap-1.5 pt-1 text-caption text-shell-label-tertiary">
                            <FileText className="h-3 w-3" strokeWidth={2} />
                            参考来源：Q3 产品路线图
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
}

export default Heroes;
