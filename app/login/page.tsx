"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PenLine } from "lucide-react";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    // 本地 Auth：POST /api/auth/login（服务端种 HttpOnly 会话 cookie）
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();

    if (!res.ok) {
      setError(data.error || "登录失败，请稍后重试");
      setLoading(false);
    } else {
      setLoading(false);
      router.push("/documents");
      router.refresh();
    }
  };

  return (
    <div className="graph-paper relative flex min-h-screen items-center justify-center px-4 before:absolute before:top-0 before:left-0 before:h-[3px] before:w-full before:bg-ai">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-8 shadow-xl shadow-ink/5">
        <div className="mb-6 flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-ai text-ai-foreground">
            <PenLine className="h-4 w-4" strokeWidth={2.5} />
          </div>
          <h1 className="font-display text-xl font-semibold tracking-tight">登录 Lotion</h1>
        </div>
        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium">邮箱</label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
              required
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">密码</label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={loading} className="w-full cursor-pointer bg-ai text-ai-foreground hover:bg-ai/90">
            {loading ? "登录中..." : "登录"}
          </Button>
        </form>
        <p className="mt-4 text-center text-sm text-muted-foreground">
          还没有账号？{" "}
          <Link href="/register" className="underline underline-offset-4 hover:text-foreground">
            注册
          </Link>
        </p>
      </div>
    </div>
  );
}
