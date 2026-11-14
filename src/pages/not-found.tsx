"use client";

// 404 页（原 Next.js 由框架默认处理，SPA 需显式提供）。
// 空状态统一走 EmptyState：此前 404 / 文档缺失 / 公开预览各写一套（图标 64/48px、标题 22/16/18px）。
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FileQuestion } from "@/components/icons";

const NotFoundPage = () => (
  <div className="flex h-full items-center justify-center">
    <EmptyState
      icon={<FileQuestion className="h-5 w-5" strokeWidth={1.5} />}
      title="页面不存在"
      action={
        <Button asChild>
          <Link to="/documents">回到文档列表</Link>
        </Button>
      }
    />
  </div>
);

export default NotFoundPage;
