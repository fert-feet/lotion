import dynamic from "next/dynamic";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Navigation from "./_components/navigation";
import { getDb } from "@/lib/local/sqlite";
import { getSessionUser, SESSION_COOKIE } from "@/lib/local/auth";

// 按需加载：AiPanel（含 react-markdown ~1.5MB）与 SearchCommand（cmdk）默认关闭，
// 首屏不加载其 chunk，打开时再拉取（ssr:false → SSR 阶段不执行，只渲染 fallback）
const AiPanel = dynamic(() => import("./_components/ai-panel"), { ssr: false });
const SearchCommand = dynamic(() => import("../../components/search-command"), { ssr: false });

// D4 决策：删除 middleware.ts 守卫后，登录检查落在本服务端布局——
// 覆盖 /documents 全部子路由（middleware 原本的守卫范围），
// 公开路由（/login /register /preview /marketing）不受影响。
const MainLayout = async ({
    children
}: { children: React.ReactNode; }) => {
    const cookieStore = await cookies();
    if (!getSessionUser(getDb(), cookieStore.get(SESSION_COOKIE)?.value)) {
        redirect("/login");
    }

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
