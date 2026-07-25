"use client";

import { useSupabaseUser } from "@/hooks/use-supabase-user";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import useSearch from "@/hooks/use-search";
import { getSearch, type Document } from "@/lib/db";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "./ui/command";
import { File } from "lucide-react";

const SearchCommand = () => {
    const { user } = useSupabaseUser();
    const router = useRouter();
    const [documents, setDocuments] = useState<Document[]>([]);
    const [isMounted, setIsMounted] = useState(false);

    const toggle = useSearch((store) => store.toggle);
    const isOpen = useSearch((store) => store.isOpen);
    const onClose = useSearch((store) => store.onClose);

    useEffect(() => {
        setIsMounted(true);
    }, []);

    useEffect(() => {
        if (isOpen && user) {
            getSearch(user.id).then(setDocuments);
        }
    }, [isOpen, user]);

    useEffect(() => {
        const down = (e: KeyboardEvent) => {
            if (e.key === "j" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                toggle();
            }
        };

        document.addEventListener("keydown", down);
        return () => document.removeEventListener("keydown", down);
    }, [toggle]);

    const onSelect = (id: string) => {
        router.push(`/documents/${id}`);
        onClose();
    };

    if (!isMounted) {
        return null;
    }

    return (
        <CommandDialog open={isOpen} onOpenChange={onClose}>
            <CommandInput
                placeholder={`Search ${user?.email?.split("@")[0]}'s Lotion...`}
            />
            <CommandList>
                <CommandEmpty>No result found.</CommandEmpty>
                <CommandGroup heading="Documents">
                    {documents?.map((document) => (
                        <CommandItem
                            key={document.id}
                            value={`${document.id} - ${document.title}`}
                            title={document.title}
                            onSelect={() => onSelect(document.id)}
                        >
                            {document.icon ? (
                                <p className="mr-2 text-[18px]">
                                    {document.icon}
                                </p>
                            ) : (
                                <File className="mr-2 h-4 w-4" />
                            )}
                            <span>
                                {document.title}
                            </span>
                        </CommandItem>
                    ))}
                </CommandGroup>
            </CommandList>
        </CommandDialog>
    );
};

export default SearchCommand;
