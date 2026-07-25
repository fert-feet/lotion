"use client"

import { Button } from "@/components/ui/button";
import { useSupabaseUser } from "@/hooks/use-supabase-user";
import { ArrowRight } from "lucide-react";
import { Spinner } from "../../../components/ui/spinner";
import Link from "next/link";

const Heading = () => {
    const { user, loading } = useSupabaseUser()
    const isAuthenticated = !!user

    return (
        <div className="max-w-3xl space-y-4 mb-20">
            <h1 className="text-3xl sm:text-5xl md:text-6xl font-bold">
                Your Ideas, Documents, & Plan. Unified. Welcome to <span className="underline">
                    Lotion
                </span>
            </h1>
            <h3 className="text-base sm:text-xl md:text-2xl font-medium">
                Lotion is the connected workspace where better, faster work happens.
            </h3>
            {loading && (
                <div className="flex justify-center">
                    <Spinner className="size-7" />
                </div>
            )}
            {!isAuthenticated && !loading && (
                <Link href="/register">
                    <Button>
                        Get Lotion Free!
                    </Button>
                </Link>
            )}
            {isAuthenticated && !loading && (
                <>
                    <Button variant="default" size="sm" asChild>
                        <Link href="/documents">
                            Enter Lotion
                            <ArrowRight className="h-5 w-5 ml-2"/>
                        </Link>
                    </Button>
                </>
            )}
        </div>
    );
}

export default Heading;
