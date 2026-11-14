import { Button } from "@/components/ui/button";
import Logo from "./logo";

// 页脚：发丝分隔线 + 弱化的文本链接，与导航栏同一套材质语言。
const Footer = () => {
    return (
        <footer className="mt-auto flex w-full items-center hairline-t border-border bg-background px-5 py-6 md:px-8">
            <Logo />
            <div className="ml-auto flex items-center gap-x-1">
                <Button variant="ghost" size="sm" className="cursor-pointer text-muted-foreground">
                    隐私政策
                </Button>
                <Button variant="ghost" size="sm" className="cursor-pointer text-muted-foreground">
                    服务条款
                </Button>
            </div>
        </footer>
    );
}

export default Footer;
