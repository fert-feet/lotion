"use client";

// 404 页（原 Next.js 由框架默认处理，SPA 需显式提供）。
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { FileQuestion } from "@/components/icons";

const NotFoundPage = () => (
  <div className="h-full flex flex-col items-center justify-center gap-4 px-6 text-center">
    <FileQuestion className="h-12 w-12 text-muted-foreground" />
    <div>
      <p className="font-display text-2xl font-semibold tracking-tight">页面不存在</p>
      <p className="mt-2 text-sm text-muted-foreground">链接可能已失效，或笔记已被删除</p>
    </div>
    <Button asChild className="mt-2 cursor-pointer bg-ai text-ai-foreground hover:bg-ai/90">
      <Link to="/documents">回到文档列表</Link>
    </Button>
  </div>
);

export default NotFoundPage;
