"use client";

import { useNavigate, Link } from "react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PenLine } from "@/components/icons";
import { useUser } from "@/hooks/use-user";

export default function RegisterPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { refreshUser } = useUser();

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    // 本地 Auth：POST /api/auth/register（注册即登录，服务端种会话 cookie）
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();

    if (!res.ok) {
      setError(data.error || "注册失败，请稍后重试");
      setLoading(false);
    } else {
      setLoading(false);
      navigate("/documents");
      refreshUser();
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[color-mix(in_srgb,var(--foreground)_4%,var(--background))] px-4">
      <div className="w-full max-w-[380px] rounded-[16px] border-[0.5px] border-shell-border-l2 bg-card p-7 shadow-[var(--shadow-lg)]">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-[12px] bg-primary text-primary-foreground shadow-[var(--shadow-sm)]">
            <PenLine className="h-6 w-6" strokeWidth={2} />
          </div>
          <div>
            <h1 className="text-[17px] font-semibold tracking-[-0.02em]">注册 Lotion</h1>
            <p className="mt-1 text-[12px] text-muted-foreground">创建账号，开始你的第一篇笔记</p>
          </div>
        </div>
        <form onSubmit={handleRegister} className="space-y-3.5">
          <div className="space-y-1.5">
            <label className="block text-[12px] font-medium text-shell-label-secondary">邮箱</label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
              required
            />
          </div>
          <div className="space-y-1.5">
            <label className="block text-[12px] font-medium text-shell-label-secondary">密码</label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>
          {error && <p className="text-[12px] text-destructive">{error}</p>}
          <Button type="submit" size="lg" disabled={loading} className="w-full">
            {loading ? "注册中…" : "注册"}
          </Button>
        </form>
        <p className="mt-5 text-center text-[12px] text-muted-foreground">
          已有账号？{" "}
          <Link to="/login" className="font-medium text-primary underline-offset-4 hover:underline">
            登录
          </Link>
        </p>
      </div>
    </div>
  );
}
