"use client"

import { Button } from "@/components/ui/button";
import { useUser } from "@/hooks/use-user";
import { ArrowRight, Sparkles } from "@/components/icons";
import { Spinner } from "../../../components/ui/spinner";
import Link from "next/link";

const Heading = () => {
    const { user, loading } = useUser()
    const isAuthenticated = !!user

    return (
        <div className="max-w-3xl mx-auto space-y-6 text-center">
            <div className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card/70 px-3 py-1 text-xs font-medium text-muted-foreground backdrop-blur">
                <Sparkles className="h-3.5 w-3.5 text-ai" />
                An AI assistant lives inside every note
            </div>
            <h1 className="font-display text-5xl sm:text-6xl md:text-7xl font-semibold tracking-tight leading-[1.04]">
                The notebook that <span className="hl-mark">thinks</span> with you.
            </h1>
            <h3 className="text-base sm:text-lg text-muted-foreground max-w-xl mx-auto leading-relaxed">
                Lotion is the connected workspace where an AI assistant writes,
                summarizes and organizes your notes — in your language.
            </h3>
            {loading && (
                <div className="flex justify-center">
                    <Spinner className="size-7" />
                </div>
            )}
            {!isAuthenticated && !loading && (
                <div className="flex items-center justify-center gap-3 pt-2">
                    <Link href="/register">
                        <Button size="lg" className="bg-ai text-ai-foreground hover:bg-ai/90 shadow-md shadow-ai/20">
                            Get Lotion Free!
                        </Button>
                    </Link>
                    <Link href="/login">
                        <Button size="lg" variant="outline">
                            Login
                        </Button>
                    </Link>
                </div>
            )}
            {isAuthenticated && !loading && (
                <div className="pt-2">
                    <Button variant="default" size="lg" asChild>
                        <Link href="/documents">
                            Enter Lotion
                            <ArrowRight className="h-5 w-5 ml-2" />
                        </Link>
                    </Button>
                </div>
            )}
        </div>
    );
}

export default Heading;
