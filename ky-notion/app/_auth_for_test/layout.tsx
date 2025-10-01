import React from "react";

const RootLayout = ({
    children
}: {
    children: React.ReactNode
}) => {
    return (
        <div className="h-full bg-red-950 text-white">
            {children}
        </div>
    );
}
// todo note: layout 文件是定义整个路由组，比如这里的 ky-notion/app/(auth)/(routes) 路由组的整体布局，{children} 就是页面的 body （我是这么理解的）
export default RootLayout;