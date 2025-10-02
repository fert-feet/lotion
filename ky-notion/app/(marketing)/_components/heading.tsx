"use client"

import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";

const Heading = () => {
    return (
        <div className="max-w-3xl space-y-4">
            <h1 className="text-3xl sm:text-5xl md:text-6xl font-bold">
                Your Ideas, Documents, & Plan. Unified. Welcome to <span className="underline">
                    Lotion
                </span>
            </h1>
            <h3 className="text-base sm:text-xl md:text-2xl font-medium">
                Lotion is the connected workspace where better, faster work happens.
            </h3>
            <Button className="font-bold">
                Enter Lotion
                <ArrowRight className="w-4 h-4"></ArrowRight>
            </Button>
        </div>
    );
}

export default Heading;