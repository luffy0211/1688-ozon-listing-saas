"use client";

import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Boxes } from "lucide-react";
import { Button, Input } from "@/components/ui";

const REMEMBER_KEY = "1688-ozon-login";

type RememberedLogin = {
  email: string;
  password: string;
};

function readRememberedLogin(): RememberedLogin | null {
  try {
    const raw = window.localStorage.getItem(REMEMBER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RememberedLogin>;
    if (typeof parsed.email !== "string" || typeof parsed.password !== "string") return null;
    return { email: parsed.email, password: parsed.password };
  } catch {
    return null;
  }
}

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberPassword, setRememberPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const remembered = readRememberedLogin();
    if (!remembered) return;
    setEmail(remembered.email);
    setPassword(remembered.password);
    setRememberPassword(true);
  }, []);

  function persistLogin() {
    if (rememberPassword) {
      window.localStorage.setItem(REMEMBER_KEY, JSON.stringify({ email, password }));
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
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError(json?.error?.message ?? "登录失败，请检查账号密码或服务状态");
        setLoading(false);
        return;
      }
      persistLogin();
      window.location.href = "/products";
    } catch {
      setError("登录失败，请确认后端和数据库服务已经启动");
      setLoading(false);
    }
  }

  return (
    <div className="grid min-h-screen bg-gray-50 lg:grid-cols-[minmax(0,1fr)_420px]">
      <section className="hidden flex-col justify-between bg-gray-950 p-10 text-white lg:flex">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-600 font-bold">OZ</span>
          <span>
            <span className="block font-semibold">1688 到 Ozon</span>
            <span className="block text-sm text-gray-400">商品上架管理后台</span>
          </span>
        </div>
        <div>
          <Boxes className="mb-6 h-10 w-10 text-blue-400" aria-hidden="true" />
          <h1 className="max-w-xl text-4xl font-semibold leading-tight">采集、选品、生成草稿和发布确认集中处理。</h1>
          <p className="mt-4 max-w-lg text-sm leading-6 text-gray-300">面向跨境卖家的商品运营工作台，默认开启真实 Ozon 发布保护。</p>
        </div>
        <p className="text-xs text-gray-500">本地开发默认账号：admin@example.com</p>
      </section>
      <main className="flex items-center justify-center px-4 py-10">
        <form onSubmit={submit} className="w-full max-w-sm rounded-lg border border-gray-200 bg-white p-8 shadow-sm">
          <div className="mb-6">
            <h1 className="text-xl font-semibold text-gray-950">登录</h1>
            <p className="mt-1 text-sm text-gray-500">进入商品上架管理后台。</p>
          </div>
          {error ? <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
          <div className="space-y-4">
            <Input label="邮箱" type="email" value={email} onChange={setEmail} required />
            <Input label="密码" type="password" value={password} onChange={setPassword} required />
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={rememberPassword}
                onChange={(e) => {
                  setRememberPassword(e.target.checked);
                  if (!e.target.checked) window.localStorage.removeItem(REMEMBER_KEY);
                }}
                className="h-4 w-4 rounded border-gray-300"
              />
              记住密码
            </label>
            <Button type="submit" disabled={loading} className="w-full">
              {loading ? "登录中..." : "登录"}
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
  );
}
