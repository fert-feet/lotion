import { Button } from "@/components/ui/button";
import Logo from "./logo";

// 页脚：发丝分隔线 + 弱化的文本链接，与导航栏同一套材质语言。
const Footer = () => {
    return (
        <footer className="mt-auto flex w-full items-center border-t-[0.5px] border-border bg-background px-5 py-6 md:px-8">
            <Logo />
            <div className="ml-auto flex items-center gap-x-1">
                <Button variant="ghost" size="sm" className="cursor-pointer text-muted-foreground">
                    Privacy Policy
                </Button>
                <Button variant="ghost" size="sm" className="cursor-pointer text-muted-foreground">
                    Terms &amp; Conditions
                </Button>
            </div>
        </footer>
    );
}

export default Footer;
