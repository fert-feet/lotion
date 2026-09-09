import { cn } from "@/lib/utils";
import { PenLine } from "@/components/icons";

const Logo = () => {
    return (
        <div className="flex items-center gap-x-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-ai text-ai-foreground shadow-sm">
                <PenLine className="h-4 w-4" strokeWidth={2.5} />
            </div>
            <p className={cn("font-display text-xl font-semibold tracking-tight")}>Lotion</p>
        </div>
    );
}

export default Logo;
