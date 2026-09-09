"use client";

// 全局错误边界（React Router errorElement）。
// 迁移自 app/error.tsx（Next.js 约定文件）——next/image 换原生 img。
import { Button } from "@/components/ui/button";
import { ArrowRight } from "@/components/icons";
import { useNavigate } from "react-router";

const ErrorBoundary = () => {
  const navigate = useNavigate();

  return (
    <div className="h-full flex flex-col items-center justify-center space-y-4">
      <div className="flex">
        <img alt="error" src="/logo.svg" width={300} height={300} />
      </div>
      <h2 className="text-lg font-bold pt-4">Something went wrong!</h2>
      <Button
        onClick={() => navigate("/documents")}
        className="text-md font-medium cursor-pointer"
      >
        Go back
        <ArrowRight className="h-5 w-5 ml-2" />
      </Button>
    </div>
  );
};

export default ErrorBoundary;
