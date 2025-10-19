
"use client";

import Image from "next/image";
import { Button } from "../components/ui/button";
import { ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";

const Error = () => {
    const router = useRouter()

    return (
        <div className="h-full flex flex-col items-center justify-center space-y-4">
            <div className="flex">
                <Image
                    alt="error"
                    src="/logo.svg"
                    width={"300"}
                    height={"300"}
                />
            </div>
            <h2 className="text-lg font-bold pt-4">
                Something went wrong!
            </h2>
            <Button onClick={() => router.push("/documents")} className="text-md font-medium cursor-pointer">
                Go back
                <ArrowRight className="h-5 w-5 ml-2" />
            </Button>
        </div>
    );
};

export default Error;