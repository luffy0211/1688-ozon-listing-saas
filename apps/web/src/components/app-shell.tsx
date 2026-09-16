"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import {
  BarChart3,
  Bot,
  ChevronDown,
  Coins,
  GitBranch,
  LayoutDashboard,
  PackageSearch,
  Settings,
  Sparkles,
} from "lucide-react";
import type { SessionPayload } from "@/lib/auth";
import { CreditBalanceBadge } from "./credit-balance-badge";
import { LogoutButton } from "./logout-button";
import { Badge, cn } from "./ui";

const navItems = [
  { href: "/dashboard", label: "上架工作台", icon: LayoutDashboard },
  { href: "/workflow", label: "自动化工作流", icon: GitBranch },
  { href: "/analytics", label: "BI 看板", icon: BarChart3 },
  { href: "/agent/content", label: "运营 Agent", icon: Bot },
  { href: "/admin/credits", label: "积分管理", icon: Coins, adminOnly: true },
  { href: "/settings", label: "设置", icon: Settings },
];

export function AppShell({
  user,
  children,
}: {
  user: SessionPayload;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const isAgentPage = pathname.startsWith("/agent/");

  return (
    <div className="min-h-screen bg-[linear-gradient(135deg,#dff7ff_0%,#f6f8ff_48%,#eeeafd_100%)] p-0 text-[#14213d] lg:p-3">
      <aside className="fixed inset-y-3 left-3 z-30 hidden w-[272px] overflow-hidden rounded-[28px] border border-white/80 bg-white/70 shadow-[0_20px_60px_rgba(48,88,145,0.13)] backdrop-blur-xl lg:flex lg:flex-col">
        <Link href="/dashboard" className="flex h-20 items-center gap-3 border-b border-[#dce8f5] px-5">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#3478f6] text-white shadow-[0_8px_20px_rgba(52,120,246,0.28)]">
            <Sparkles className="h-5 w-5" aria-hidden="true" />
          </span>
          <span className="min-w-0">
            <span className="block text-[15px] font-bold text-[#17223d]">Ozon 运营中心</span>
            <span className="mt-0.5 block text-xs text-[#8290a8]">跨境智能增长工作台</span>
          </span>
        </Link>

        <div className="px-4 pt-4">
          <Link
            href="/agent/content"
            className="flex h-11 items-center justify-center gap-2 rounded-xl bg-[#3478f6] px-4 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(52,120,246,0.24)] transition-colors hover:bg-[#2868df]"
          >
            <Bot className="h-4 w-4" aria-hidden="true" />
            开始 Agent 对话
          </Link>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-5">
          <div className="mb-2 px-3 text-[11px] font-semibold text-[#9aa6ba]">工作空间</div>
          {navItems.filter((item) => !item.adminOnly || user.role === "admin").map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex h-11 items-center gap-3 rounded-xl px-3 text-sm font-semibold transition-all",
                  active
                    ? "bg-white text-[#2465dd] shadow-[0_7px_22px_rgba(54,88,140,0.10)]"
                    : "text-[#52627b] hover:bg-white/65 hover:text-[#1d2b49]",
                )}
              >
                <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
                {item.label}
                {item.href === "/agent/content" ? (
                  <span className="ml-auto h-2 w-2 rounded-full bg-[#36bd8c]" aria-label="Agent 在线" />
                ) : null}
              </Link>
            );
          })}
        </nav>

        <div className="mx-3 mb-3 border-t border-[#dce8f5] p-3 pt-4">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#eaf1ff] text-xs font-bold text-[#2465dd]">
              {user.email.slice(0, 2).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-[#26334d]">{user.email}</div>
              <Badge tone={user.role === "admin" ? "violet" : "gray"} className="mt-1">
                {user.role}
              </Badge>
            </div>
            <LogoutButton />
          </div>
        </div>
      </aside>

      <div className="min-h-[calc(100vh-24px)] lg:pl-[288px]">
        <div className="min-h-[calc(100vh-24px)] overflow-hidden bg-[#f8fbff]/85 shadow-[0_20px_60px_rgba(48,88,145,0.10)] backdrop-blur-xl lg:rounded-[28px] lg:border lg:border-white/80">
          <header className="sticky top-0 z-20 border-b border-[#e3ebf5] bg-white/80 backdrop-blur-xl">
            <div className="flex h-16 items-center justify-between gap-3 px-4 md:px-6">
              <Link href={isAgentPage ? "/agent/content" : "/dashboard"} className="flex items-center gap-2 lg:hidden">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#3478f6] text-white">
                  {isAgentPage ? <Bot className="h-4 w-4" aria-hidden="true" /> : <Sparkles className="h-4 w-4" aria-hidden="true" />}
                </span>
                <span className="text-sm font-bold">{isAgentPage ? "Ozon 运营 Agent" : "Ozon 运营中心"}</span>
              </Link>
              <div className="hidden items-center gap-3 lg:flex">
                <span className={cn(
                  "flex h-9 w-9 items-center justify-center rounded-xl",
                  isAgentPage ? "bg-[#3478f6] text-white" : "bg-[#f1f5fb] text-[#52627b]",
                )}>
                  {isAgentPage ? <Bot className="h-4 w-4" aria-hidden="true" /> : <PackageSearch className="h-4 w-4" aria-hidden="true" />}
                </span>
                {isAgentPage ? (
                  <div>
                    <div className="text-sm font-bold text-[#26334d]">Ozon 运营 Agent</div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-xs font-medium text-[#8290a8]">
                      <span className="h-1.5 w-1.5 rounded-full bg-[#36bd8c]" />
                      在线 · 诊断、竞品与审批执行
                    </div>
                  </div>
                ) : (
                  <div className="flex h-9 items-center gap-2 rounded-xl bg-white px-3 text-sm font-semibold text-[#26334d] shadow-[0_4px_14px_rgba(55,84,130,0.08)]">
                    Ozon 店铺工作区
                    <ChevronDown className="h-3.5 w-3.5 text-[#9aa6ba]" aria-hidden="true" />
                  </div>
                )}
              </div>
              <div className="flex min-w-0 items-center gap-2">
                <CreditBalanceBadge />
                {isAgentPage ? (
                  <>
                    <span className="hidden rounded-full border border-[#cdeee3] bg-[#ebfbf5] px-2.5 py-1 text-xs font-semibold text-[#168864] sm:inline-flex">改动需确认</span>
                    <span className="hidden rounded-full border border-[#dbe6fb] bg-[#f2f6fd] px-2.5 py-1 text-xs font-semibold text-[#52627b] md:inline-flex">读取直接执行</span>
                  </>
                ) : (
                  <span className="hidden items-center gap-1.5 rounded-full border border-[#cdeee3] bg-[#ebfbf5] px-3 py-1.5 text-xs font-semibold text-[#168864] sm:inline-flex">
                    <span className="h-2 w-2 rounded-full bg-[#36bd8c]" />
                    系统在线
                  </span>
                )}
                <Link
                  href="/settings"
                  aria-label="设置"
                  title="设置"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white bg-white text-[#52627b] shadow-[0_4px_14px_rgba(55,84,130,0.08)] transition-colors hover:text-[#2465dd]"
                >
                  <Settings className="h-4 w-4" aria-hidden="true" />
                </Link>
                <div className="lg:hidden">
                  <LogoutButton />
                </div>
              </div>
            </div>
            <nav className="scrollbar-none flex gap-1 overflow-x-auto border-t border-[#edf2f8] px-3 py-2 lg:hidden">
              {navItems.filter((item) => !item.adminOnly || user.role === "admin").map((item) => {
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
          <main className="w-full px-4 py-5 md:px-6 md:py-6">{children}</main>
        </div>
      </div>
    </div>
  );
}
