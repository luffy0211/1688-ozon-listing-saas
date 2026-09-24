"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Coins, LayoutDashboard, Users } from "lucide-react";
import type { SessionPayload } from "@/lib/auth";
import { LogoutButton } from "./logout-button";
import { Badge, cn } from "./ui";

const adminNavItems = [
  { href: "/admin", label: "后台首页", icon: LayoutDashboard },
  { href: "/admin/tenants", label: "租户管理", icon: Users },
  { href: "/admin/credits", label: "积分管理", icon: Coins },
];

export function AdminShell({
  user,
  children,
}: {
  user: SessionPayload;
  children: ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-[#eef5ff] text-[#17223d] lg:p-3">
      <aside className="fixed inset-y-3 left-3 z-30 hidden w-[260px] overflow-hidden rounded-[24px] border border-white bg-[#111827] text-white shadow-[0_20px_60px_rgba(16,24,40,0.18)] lg:flex lg:flex-col">
        <Link href="/admin" className="flex h-20 items-center gap-3 border-b border-white/10 px-5">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#3478f6]">
            <LayoutDashboard className="h-5 w-5" aria-hidden="true" />
          </span>
          <span>
            <span className="block text-sm font-bold">平台管理后台</span>
            <span className="block text-xs text-white/55">Admin Console</span>
          </span>
        </Link>

        <nav className="flex-1 space-y-1 px-3 py-5">
          <div className="mb-2 px-3 text-[11px] font-semibold text-white/40">管理菜单</div>
          {adminNavItems.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex h-11 items-center gap-3 rounded-xl px-3 text-sm font-semibold transition-colors",
                  active ? "bg-white text-[#17223d]" : "text-white/70 hover:bg-white/10 hover:text-white",
                )}
              >
                <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="mx-3 mb-3 border-t border-white/10 p-3 pt-4">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/10 text-xs font-bold">
              {user.email.slice(0, 2).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">{user.email}</div>
              <Badge tone="violet" className="mt-1">admin</Badge>
            </div>
            <LogoutButton redirectTo="/admin/login" />
          </div>
        </div>
      </aside>

      <div className="min-h-screen lg:pl-[276px]">
        <header className="sticky top-0 z-20 border-b border-[#dbe6f3] bg-white/85 backdrop-blur-xl lg:rounded-t-[24px]">
          <div className="flex h-16 items-center justify-between px-4 md:px-6">
            <div>
              <div className="text-sm font-bold text-[#17223d]">平台管理后台</div>
              <div className="mt-0.5 text-xs font-medium text-[#8290a8]">租户、积分和平台运营配置</div>
            </div>
            <div className="flex items-center gap-2 lg:hidden">
              <LogoutButton redirectTo="/admin/login" />
            </div>
          </div>
          <nav className="scrollbar-none flex gap-1 overflow-x-auto border-t border-[#edf2f8] px-3 py-2 lg:hidden">
            {adminNavItems.map((item) => {
              const Icon = item.icon;
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "inline-flex h-9 shrink-0 items-center gap-2 rounded-xl px-3 text-sm font-semibold",
                    active ? "bg-[#eaf1ff] text-[#2465dd]" : "text-[#67758e] hover:bg-white",
                  )}
                >
                  <Icon className="h-4 w-4" aria-hidden="true" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </header>
        <main className="px-4 py-5 md:px-6 md:py-6">{children}</main>
      </div>
    </div>
  );
}
