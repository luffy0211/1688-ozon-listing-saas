"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import {
  BarChart3,
  Bot,
  Boxes,
  ClipboardList,
  LayoutDashboard,
  PackageCheck,
  PackageSearch,
  Settings,
  Store,
  Truck,
} from "lucide-react";
import type { SessionPayload } from "@/lib/auth";
import { LogoutButton } from "./logout-button";
import { Badge, cn } from "./ui";

const navItems = [
  { href: "/dashboard", label: "工作台", icon: LayoutDashboard },
  { href: "/analytics", label: "数据看板", icon: BarChart3 },
  { href: "/agent/content", label: "Ozon Agent", icon: Bot },
  { href: "/shops", label: "采集选品", icon: Store },
  { href: "/products", label: "商品池", icon: Boxes },
  { href: "/drafts", label: "待发布", icon: PackageCheck },
  { href: "/jobs", label: "任务记录", icon: ClipboardList },
  { href: "/suppliers", label: "供应商", icon: Truck },
];

export function AppShell({
  user,
  children,
}: {
  user: SessionPayload;
  children: ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-gray-50 text-gray-950">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-gray-200 bg-white lg:flex lg:flex-col">
        <Link href="/products" className="flex h-16 items-center gap-3 border-b border-gray-200 px-5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600 text-sm font-bold text-white">
            OZ
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-gray-950">1688 到 Ozon</span>
            <span className="block text-xs text-gray-500">商品上架工作台</span>
          </span>
        </Link>

        <nav className="flex-1 space-y-1 px-3 py-4">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex h-10 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors",
                  active ? "bg-blue-50 text-blue-700" : "text-gray-600 hover:bg-gray-100 hover:text-gray-950",
                )}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-gray-200 p-4">
          <div className="min-w-0 rounded-lg bg-gray-50 p-3">
            <div className="truncate text-sm font-medium text-gray-900">{user.email}</div>
            <div className="mt-2 flex items-center justify-between gap-2">
              <Badge tone={user.role === "admin" ? "violet" : "gray"}>{user.role}</Badge>
              <LogoutButton />
            </div>
          </div>
        </div>
      </aside>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 border-b border-gray-200 bg-white/95 backdrop-blur">
          <div className="flex h-14 items-center justify-between gap-3 px-4 md:px-6">
            <Link href="/products" className="flex items-center gap-2 lg:hidden">
              <span className="flex h-8 w-8 items-center justify-center rounded-md bg-blue-600 text-xs font-bold text-white">
                OZ
              </span>
              <span className="text-sm font-semibold">1688 到 Ozon</span>
            </Link>
            <div className="hidden items-center gap-2 text-sm text-gray-500 lg:flex">
              <PackageSearch className="h-4 w-4" />
              今天要处理的商品、草稿和失败任务
            </div>
            <div className="flex min-w-0 items-center gap-2">
              <div className="hidden min-w-0 text-right sm:block">
                <div className="truncate text-sm font-medium text-gray-700">{user.email}</div>
                <div className="text-xs text-gray-500">{user.role}</div>
              </div>
              <Link
                href="/settings"
                className="inline-flex h-9 items-center gap-2 rounded-md border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                <Settings className="h-4 w-4" aria-hidden="true" />
                设置
              </Link>
              <div className="lg:hidden">
                <LogoutButton />
              </div>
            </div>
          </div>
          <nav className="flex gap-1 overflow-x-auto border-t border-gray-100 px-3 py-2 lg:hidden">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "inline-flex h-9 shrink-0 items-center gap-2 rounded-md px-3 text-sm font-medium",
                    active ? "bg-blue-50 text-blue-700" : "text-gray-600 hover:bg-gray-100",
                  )}
                >
                  <Icon className="h-4 w-4" aria-hidden="true" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-5 md:px-6 md:py-7">{children}</main>
      </div>
    </div>
  );
}
