import React from "react";
import Navbar from "./_components/navbar";

const MarketingLayout = ({
    children
}: {
    children: React.ReactNode
}) => {
    return (
        <div className="h-full">
            <Navbar />
            <main className="h-full dark:bg-[#1f1f1f] pt-40">
                {children}
            </main>
        </div>
     );
}
 
export default MarketingLayout;