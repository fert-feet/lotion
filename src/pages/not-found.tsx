"use client";

// 404 页（原 Next.js 由框架默认处理，SPA 需显式提供）。
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { FileQuestion } from "@/components/icons";

const NotFoundPage = () => (
  <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
    <div className="flex h-16 w-16 items-center justify-center rounded-[18px] bg-secondary text-shell-label-tertiary"><FileQuestion className="h-7 w-7" strokeWidth={1.5} /></div>
    <div>
      <p className="text-[19px] font-semibold tracking-[-0.02em]">页面不存在</p>
      <p className="mt-1.5 text-[13px] text-muted-foreground">链接可能已失效，或笔记已被删除</p>
    </div>
    <Button asChild className="mt-3">
      <Link to="/documents">回到文档列表</Link>
    </Button>
  </div>
);

export default NotFoundPage;
