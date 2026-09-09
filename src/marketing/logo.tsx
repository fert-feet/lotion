import { PenLine } from "@/components/icons";

// 品牌标识：系统蓝圆角方块（macOS app icon 的连续圆角）+ 字标。
// 字标用系统 SF 栈、15px semibold、紧字距，不再使用衬线 font-display。
const Logo = () => {
    return (
        <div className="flex items-center gap-x-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-[7px] bg-primary text-primary-foreground shadow-[var(--shadow-sm)]">
                <PenLine className="h-4 w-4" strokeWidth={2} />
            </div>
            <p className="text-[15px] font-semibold tracking-[-0.02em]">Lotion</p>
        </div>
    );
}

export default Logo;
