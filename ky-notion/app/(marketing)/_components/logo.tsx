import { Poppins } from "next/font/google";
import Image from "next/image";
import { cn } from "@/lib/utils";

const font = Poppins({
    subsets: ["latin"],
    weight: ["400", "600"]
})

const Logo = () => {
    return ( 
        <div className="hidden md:flex items-center gap-x-2">
            <Image 
            src="/logo.svg"
            height="30"
            width="30"
            alt="Logo"
            />
            {/* <Image 
            src="/logo.svg"
            height="30"
            width="30"
            alt="Logo"
            className="hidden dark:block"
            /> */}
            <p className={cn("font-semibold", font.className)}>Lotion</p>
        </div>
     );
}
 
export default Logo;