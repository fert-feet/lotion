"use client"

import { useSupabaseUser } from "@/hooks/use-supabase-user";
import { DropdownMenuContent, DropdownMenu, DropdownMenuTrigger, DropdownMenuSeparator, DropdownMenuItem } from "../../../components/ui/dropdown-menu";
import { Avatar, AvatarImage } from "../../../components/ui/avatar";
import { ChevronsLeftRight } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

const UserItem = () => {
    const { user } = useSupabaseUser()
    const router = useRouter()

    const handleSignOut = async () => {
        const supabase = createClient()
        await supabase.auth.signOut()
        router.push("/login")
        router.refresh()
    }

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <div role="button" className="flex cursor-pointer items-center text-sm p-3 w-full hover:bg-primary/5 rounded-sm transition-colors duration-150">
                    <div className="flex gap-x-2 items-center max-w-[150px]">
                        <Avatar className="h-6 w-6">
                            <AvatarImage src={user?.user_metadata?.avatar_url} />
                        </Avatar>
                        <span className="text-start font-medium line-clamp-1">
                            {user?.email?.split("@")[0]}&apos;s Lotion
                        </span>
                    </div>
                    <ChevronsLeftRight className="rotate-90 ml-2 text-muted-foreground h-4 w-4" />
                </div>
            </DropdownMenuTrigger>

            <DropdownMenuContent
                className="w-80"
                align="start"
                alignOffset={11}
                forceMount
            >
                <div className="flex flex-col space-y-4 p-2">
                    <p className="text-xs font-medium leading-none text-muted-foreground">
                        {user?.email}
                    </p>
                </div>
                <div className="gap-x-2 flex items-center p-2">
                    <div className="">
                        <Avatar className="h-8 w-8">
                            <AvatarImage src={user?.user_metadata?.avatar_url} />
                        </Avatar>
                    </div>
                    <div>
                        <span className="text-sm text-start line-clamp-1">
                            {user?.email}&apos;s Lotion
                        </span>
                    </div>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleSignOut} className="w-full text-muted-foreground cursor-pointer">
                    Sign out
                </DropdownMenuItem>
            </DropdownMenuContent>

        </DropdownMenu>
    );
}

export default UserItem;
