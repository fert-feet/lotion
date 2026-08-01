"use client";

import dynamic from "next/dynamic";
import Navigation from "./_components/navigation";

// 按需加载：AiPanel（含 react-markdown ~1.5MB）与 SearchCommand（cmdk）默认关闭，
// 首屏不加载其 chunk，打开时再拉取（ssr:false → SSR 阶段不执行，只渲染 fallback）
const AiPanel = dynamic(() => import("./_components/ai-panel"), { ssr: false });
const SearchCommand = dynamic(() => import("../../components/search-command"), { ssr: false });

const MainLayout = ({
    children
}: { children: React.ReactNode; }) => {
    return (
        <div className="h-full flex">
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
