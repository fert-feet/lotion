"use client";

import type { Document } from "@/lib/seams/doc-store";
import { Skeleton } from "@/components/ui/skeleton";

interface TitleProps {
  initialData: Document;
}

/**
 * 顶栏标题只负责定位当前文档，不承担编辑。
 * 正文工具栏是唯一标题编辑入口，避免两套防抖、刷新和错误处理互相打架。
 */
const Title = ({ initialData }: TitleProps) => (
  <div className="flex min-w-0 items-center gap-1">
    {initialData.icon && <span className="text-ui leading-none">{initialData.icon}</span>}
    <span
      className="truncate px-1.5 text-ui font-medium text-shell-label-secondary"
      title={initialData.title || "未命名"}
    >
      {initialData.title || "未命名"}
    </span>
  </div>
);

Title.Skeleton = function TitleSkeleton() {
  return <Skeleton className="mt-1 h-5.5 w-28 rounded-control" />;
};

export default Title;
