"use client"

import { SignOutButton, useUser } from "@clerk/nextjs";
import { DropdownMenuContent, DropdownMenu, DropdownMenuTrigger, DropdownMenuSeparator, DropdownMenuItem } from "../../../components/ui/dropdown-menu";
import { Avatar, AvatarImage } from "../../../components/ui/avatar";
import { ChevronsLeftRight } from "lucide-react";
import { use } from "react";

const UserItem = () => {
    const { user } = useUser()

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <div role="button" className="flex cursor-pointer items-center text-sm p-3 w-full hover:bg-primary/5">
                    <div className="flex gap-x-2 items-center max-w-[150px]">
                        <Avatar className="h-5 w-5">
                            <AvatarImage src={user?.imageUrl} />
                        </Avatar>
                        <span className="text-start font-medium line-clamp-1">
                            {user?.username}&apos;s Lotion
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
                        {user?.emailAddresses[0].emailAddress}
                    </p>
                </div>
                <div className="gap-x-2 flex items-center p-2">
                    <div className="">
                        <Avatar className="h-8 w-8">
                            <AvatarImage src={user?.imageUrl} />
                        </Avatar>
                    </div>
                    <div>
                        <span className="text-sm text-start line-clamp-1">
                            {user?.username}&apos;s Lotion
                        </span>
                    </div>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild className="w-full text-muted-foreground cursor-pointer">
                    <SignOutButton>
                        Sign out
                    </SignOutButton>
                </DropdownMenuItem>
            </DropdownMenuContent>

        </DropdownMenu>
    );
}

export default UserItem;