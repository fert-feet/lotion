"use client";

import Navigation from "./_components/navigation";
import SearchCommand from "../../components/search-command";
import SettingsModal from "../../components/modals/settings-modal";
import AiPanel from "./_components/ai-panel";

const MainLayout = ({
    children
}: { children: React.ReactNode; }) => {
    return (
        <div className="h-full flex dark:bg-[#1f1f1f]">
            <Navigation />
            <main className="flex-1 h-full overflow-y-auto">
                <SearchCommand />
                {children}
            </main>
            <AiPanel />
        </div>
    );
};

export default MainLayout;