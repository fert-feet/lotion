import { FolderTree, PenLine, Sparkles } from "@/components/icons";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";

// 特性区 + 收尾 CTA：Apple 产品页的三栏卡片（发丝边、柔和投影、hover 只抬升阴影、无位移），
// 图标底衬用系统蓝的 10% 染色，强调色全站只有系统蓝一种。
const features = [
    {
        icon: PenLine,
        title: "自由书写",
        description: "嵌套页面、封面与图标，让笔记按你思考的方式组织。",
    },
    {
        icon: Sparkles,
        title: "向笔记提问",
        description: "和读过你全部文档的 AI 助手对话，回答都带引用。",
    },
    {
        icon: FolderTree,
        title: "保持有序",
        description: "搜索、归档、批量管理，一切都在同一个连通的空间里。",
    },
];

const LandingText = () => {
    return (
        <section className="mx-auto w-full max-w-[1000px] py-6 md:py-10">
            <div className="mx-auto max-w-[680px] text-center">
                <h2 className="text-balance text-display font-bold leading-[1.1] tracking-[-0.025em] md:text-hero">
                    为你思考的方式而生
                </h2>
                <p className="mt-4 text-body leading-[1.5] text-muted-foreground">
                    笔记、页面与 AI 助手，一个安静而连通的工作空间。
                </p>
            </div>

            <div className="mt-12 grid gap-4 md:grid-cols-3">
                {features.map((f) => (
                    <div
                        key={f.title}
                        className="rounded-panel hairline border-border bg-card p-6 shadow-elevation-1 transition-shadow duration-150 hover:shadow-elevation-2"
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
            <div className="mx-auto mt-16 max-w-[680px] rounded-sheet hairline border-border bg-card px-8 py-14 text-center shadow-elevation-1 md:py-20">
                <h2 className="text-balance text-display font-bold leading-[1.1] tracking-[-0.025em] md:text-hero">
                    和<span className="text-primary">你的 AI</span>一起写作。
                </h2>
                <p className="mt-4 text-body leading-[1.5] text-muted-foreground">
                    免费开始，无需信用卡。
                </p>
                <div className="mt-8">
                    <Link to="/register">
                        <Button className="h-11 rounded-card px-6 text-lead font-medium active:scale-[0.98]">
                            免费开始使用
                        </Button>
                    </Link>
                </div>
            </div>
        </section>
    );
}

export default LandingText;
