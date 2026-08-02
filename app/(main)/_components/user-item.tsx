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

    const displayName = user?.user_metadata?.full_name || user?.email?.split("@")[0] || "Lotion 用户"

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <div role="button" className="flex cursor-pointer items-center gap-2 px-3 py-2 mx-1.5 my-1 rounded-md hover:bg-sidebar-accent/70 transition-colors duration-150">
                    <Avatar className="h-7 w-7 shrink-0">
                        <AvatarImage src={user?.user_metadata?.avatar_url} />
                    </Avatar>
                    <span className="flex-1 text-start text-sm font-medium truncate">
                        {displayName}
                    </span>
                    <ChevronsLeftRight className="rotate-90 text-muted-foreground h-3.5 w-3.5 shrink-0" />
                </div>
            </DropdownMenuTrigger>

            <DropdownMenuContent
                className="w-72"
                align="start"
                alignOffset={11}
                forceMount
            >
                <div className="flex items-center gap-3 p-3">
                    <Avatar className="h-9 w-9">
                        <AvatarImage src={user?.user_metadata?.avatar_url} />
                    </Avatar>
                    <div className="min-w-0">
                        <p className="text-sm font-medium truncate">
                            {displayName}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                            {user?.email}
                        </p>
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
