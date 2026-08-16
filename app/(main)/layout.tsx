import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import AppShell from "./_components/app-shell";
import { LazySearchCommand } from "./_components/lazy-panels";
import { getDb } from "@/lib/local/sqlite";
import { getSessionUser, SESSION_COOKIE } from "@/lib/local/auth";

// D4 决策：删除 middleware.ts 守卫后，登录检查落在本服务端布局——
// 覆盖 /documents 全部子路由（middleware 原本的守卫范围），
// 公开路由（/login /register /preview /marketing）不受影响。
// 大块依赖（AiPanel/SearchCommand）经客户端包装组件 lazy-panels 按需加载。
const MainLayout = async ({
    children
}: { children: React.ReactNode; }) => {
    const cookieStore = await cookies();
    if (!getSessionUser(getDb(), cookieStore.get(SESSION_COOKIE)?.value)) {
        redirect("/login");
    }

    return (
        <div className="h-full">
            {/* DSH 风格三栏 shell：sidebar | center | details，见 app-shell.tsx */}
            <AppShell>
                <LazySearchCommand />
                {children}
            </AppShell>
        </div>
    );
};

export default MainLayout;
