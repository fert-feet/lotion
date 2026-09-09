"use client";

// 全局错误边界（React Router errorElement）。
// 迁移自 app/error.tsx（Next.js 约定文件）——next/image 换原生 img。
import { Button } from "@/components/ui/button";
import { ArrowRight } from "@/components/icons";
import { useNavigate } from "react-router";

const ErrorBoundary = () => {
  const navigate = useNavigate();

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3">
      <div className="flex">
        <img alt="error" src="/logo.svg" width={300} height={300} />
      </div>
      <h2 className="text-[19px] font-semibold tracking-[-0.02em]">出了点问题</h2>
      <Button
        onClick={() => navigate("/documents")}
        className="mt-1"
      >
        Go back
        <ArrowRight className="h-4 w-4" />
      </Button>
    </div>
  );
};

export default ErrorBoundary;
