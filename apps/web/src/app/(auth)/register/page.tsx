"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { Button, Input } from "@/components/ui";

export default function RegisterPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [inviteCode, setInviteCode] = useState(
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("invite") ?? ""
      : "",
  );
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/v1/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, name, inviteCode }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError(json?.error?.message ?? "注册失败，请检查邀请码或服务状态");
        setLoading(false);
        return;
      }
      window.location.href = "/products";
    } catch {
      setError("注册失败，请确认后端和数据库服务已经启动");
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[linear-gradient(135deg,#dff7ff_0%,#f6f8ff_48%,#eeeafd_100%)] px-4 py-10">
      <form onSubmit={submit} className="w-full max-w-md rounded-2xl border border-white bg-white/85 p-8 shadow-[0_20px_60px_rgba(48,88,145,0.13)] backdrop-blur-xl">
        <div className="mb-6">
          <div className="mb-4 flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#3478f6] text-white shadow-[0_8px_20px_rgba(52,120,246,0.22)]"><Sparkles className="h-5 w-5" aria-hidden="true" /></span>
            <span className="font-bold text-[#17223d]">Ozon 运营中心</span>
          </div>
          <h1 className="text-2xl font-bold text-[#17223d]">加入工作区</h1>
          <p className="mt-1 text-sm text-[#8290a8]">使用邀请码创建团队账号。</p>
        </div>
        {error ? <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
        <div className="space-y-4">
          <Input label="邀请码" value={inviteCode} onChange={setInviteCode} required />
          <Input label="邮箱" type="email" value={email} onChange={setEmail} required />
          <Input label="姓名（可选）" value={name} onChange={setName} />
          <Input label="密码（至少 8 位）" type="password" value={password} onChange={setPassword} required />
          <Button type="submit" disabled={loading} className="h-11 w-full bg-[#3478f6] hover:bg-[#2868df]">
            {loading ? "注册中..." : "注册"}
          </Button>
        </div>
        <p className="mt-4 text-center text-sm text-gray-500">
          已有账号？{" "}
          <Link href="/login" className="font-medium text-blue-700 hover:underline">
            去登录
          </Link>
        </p>
      </form>
    </div>
  );
}
