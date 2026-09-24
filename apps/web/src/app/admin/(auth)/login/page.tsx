"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { Button, Input } from "@/components/ui";

export default function AdminLoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, adminOnly: true }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        setError(json?.error?.message ?? "登录失败，请检查管理者账号");
        setLoading(false);
        return;
      }
      window.location.assign("/admin");
    } catch {
      setError("登录失败，请确认服务状态");
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#eef5ff] px-5 py-10">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl border border-white bg-white p-8 shadow-[0_18px_50px_rgba(48,78,124,0.13)]">
        <div className="mb-6">
          <span className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#111827] text-white">
            <ShieldCheck className="h-6 w-6" aria-hidden="true" />
          </span>
          <h1 className="text-2xl font-bold text-[#17223d]">管理后台登录</h1>
          <p className="mt-1 text-sm text-[#8290a8]">仅平台管理者账号可进入。</p>
        </div>
        {error ? <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
        <div className="space-y-4">
          <Input label="管理员邮箱" type="email" value={email} onChange={setEmail} required />
          <Input label="密码" type="password" value={password} onChange={setPassword} required />
          <Button type="submit" disabled={loading} className="h-11 w-full bg-[#111827] hover:bg-[#1f2937]">
            {loading ? "登录中..." : "进入后台"}
          </Button>
        </div>
        <p className="mt-4 text-center text-sm text-gray-500">
          客户入口：{" "}
          <Link href="/login" className="font-medium text-blue-700 hover:underline">
            用户登录
          </Link>
        </p>
      </form>
    </div>
  );
}
