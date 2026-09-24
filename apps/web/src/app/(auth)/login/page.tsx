"use client";

import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Bot, CheckCircle2, Sparkles } from "lucide-react";
import { Button, Input } from "@/components/ui";

const REMEMBER_KEY = "1688-ozon-login";

type RememberedLogin = {
  email: string;
};

function readRememberedLogin(): RememberedLogin | null {
  try {
    const raw = window.localStorage.getItem(REMEMBER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RememberedLogin>;
    if (typeof parsed.email !== "string") return null;
    return { email: parsed.email };
  } catch {
    return null;
  }
}

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberEmail, setRememberEmail] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const remembered = readRememberedLogin();
    if (!remembered) return;
    setEmail(remembered.email);
    setRememberEmail(true);
  }, []);

  function persistLogin() {
    if (rememberEmail) {
      window.localStorage.setItem(REMEMBER_KEY, JSON.stringify({ email }));
    } else {
      window.localStorage.removeItem(REMEMBER_KEY);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        setError(json?.error?.message ?? "登录失败，请检查账号密码或服务状态");
        setLoading(false);
        return;
      }
      persistLogin();
      const json = await res.json().catch(() => null);
      window.location.assign(json?.data?.user?.role === "admin" ? "/admin" : "/agent/content");
    } catch {
      setError("登录失败，请确认后端和数据库服务已经启动");
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[linear-gradient(135deg,#dff7ff_0%,#f6f8ff_48%,#eeeafd_100%)] p-0 lg:p-4">
      <div className="grid min-h-screen overflow-hidden border border-white/80 bg-white/45 shadow-[0_24px_70px_rgba(48,88,145,0.14)] backdrop-blur-xl lg:min-h-[calc(100vh-32px)] lg:grid-cols-[minmax(0,1fr)_460px] lg:rounded-[28px]">
      <section className="hidden flex-col justify-between bg-[linear-gradient(145deg,rgba(231,248,255,0.92),rgba(239,235,255,0.92))] p-12 text-[#17223d] lg:flex">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#3478f6] text-white shadow-[0_10px_24px_rgba(52,120,246,0.24)]"><Sparkles className="h-5 w-5" aria-hidden="true" /></span>
          <span>
            <span className="block font-bold">Ozon 运营中心</span>
            <span className="block text-sm text-[#8290a8]">跨境智能增长工作台</span>
          </span>
        </div>
        <div>
          <span className="mb-6 flex h-12 w-12 items-center justify-center rounded-2xl bg-white/80 text-[#3478f6] shadow-[0_8px_24px_rgba(48,78,124,0.08)]"><Bot className="h-6 w-6" aria-hidden="true" /></span>
          <h1 className="max-w-xl text-4xl font-bold leading-tight">从 1688 选品到 Ozon 运营，一个工作台完成。</h1>
          <p className="mt-4 max-w-lg text-sm leading-6 text-[#60708a]">采集、翻译、上架、数据复盘和 Agent 优化集中处理。</p>
          <div className="mt-7 grid max-w-lg grid-cols-2 gap-3 text-sm font-medium text-[#52627b]">
            {["自动化商品上架", "真实经营数据", "智能运营诊断", "高风险操作保护"].map((item) => (
              <span key={item} className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-[#21a77b]" aria-hidden="true" />{item}</span>
            ))}
          </div>
        </div>
        <p className="text-xs text-[#9aa6ba]">Enterprise Commerce Operations</p>
      </section>
      <main className="flex items-center justify-center bg-white/55 px-5 py-10 backdrop-blur-xl">
        <form onSubmit={submit} className="w-full max-w-sm rounded-2xl border border-white bg-white/90 p-8 shadow-[0_18px_50px_rgba(48,78,124,0.11)]">
          <div className="mb-6">
            <div className="mb-5 flex items-center gap-3 lg:hidden">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#3478f6] text-white"><Sparkles className="h-5 w-5" aria-hidden="true" /></span>
              <span className="font-bold text-[#17223d]">Ozon 运营中心</span>
            </div>
            <h1 className="text-2xl font-bold text-[#17223d]">欢迎回来</h1>
            <p className="mt-1 text-sm text-[#8290a8]">登录后继续管理跨境业务。</p>
          </div>
          {error ? <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
          <div className="space-y-4">
            <Input label="邮箱" type="email" value={email} onChange={setEmail} required />
            <Input label="密码" type="password" value={password} onChange={setPassword} required />
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={rememberEmail}
                onChange={(e) => {
                  setRememberEmail(e.target.checked);
                  if (!e.target.checked) window.localStorage.removeItem(REMEMBER_KEY);
                }}
                className="h-4 w-4 rounded border-gray-300"
              />
              记住邮箱
            </label>
            <Button type="submit" disabled={loading} className="h-11 w-full bg-[#3478f6] hover:bg-[#2868df]">
              {loading ? "登录中..." : "进入工作台"}
            </Button>
          </div>
          <p className="mt-4 text-center text-sm text-gray-500">
            没有账号？{" "}
            <Link href="/register" className="font-medium text-blue-700 hover:underline">
              使用邀请码注册
            </Link>
          </p>
        </form>
      </main>
      </div>
    </div>
  );
}
