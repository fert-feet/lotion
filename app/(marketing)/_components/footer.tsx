import { Button } from "../../../components/ui/button";
import Logo from "./logo";

const Footer = () => {
    return (
        <div className="flex items-center w-full px-6 py-6 bg-background z-50 mt-auto border-t border-border/60">
            <Logo />
            <div className="md:ml-auto w-full justify-between md:justify-end flex items-center gap-x-2 text-muted-foreground">
                <Button variant="ghost" size="sm" className="cursor-pointer">Privacy Policy</Button>
                <Button variant="ghost" size="sm" className="cursor-pointer">Terms &amp; Conditions</Button>
            </div>
        </div>
    );
}

export default Footer;
