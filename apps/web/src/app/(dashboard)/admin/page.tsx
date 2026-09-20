import Link from "next/link";
import {
  BarChart3,
  Coins,
  FileCheck2,
  GitBranch,
  Settings,
  ShieldCheck,
  Store,
  Users,
} from "lucide-react";
import { prisma } from "@saas/db";
import { requireAdmin } from "@/lib/auth";
import { Card, MetricCard, PageHeader } from "@/components/ui";

const adminLinks = [
  { href: "/admin/tenants", title: "租户管理", description: "查看客户、用户、店铺和任务数量。", icon: Users },
  { href: "/admin/credits", title: "积分管理", description: "给客户加减积分，查看积分流水。", icon: Coins },
  { href: "/stores", title: "店铺 API", description: "管理 Ozon 店铺绑定和密钥状态。", icon: Store },
  { href: "/agent/actions", title: "待审批", description: "查看 Agent 生成的待确认动作。", icon: FileCheck2 },
  { href: "/agent/reports", title: "Agent 报告", description: "查看店铺诊断和竞品分析证据。", icon: BarChart3 },
  { href: "/workflow", title: "自动化工作流", description: "查看采集、上架和运营自动化流程。", icon: GitBranch },
  { href: "/settings", title: "系统设置", description: "管理基础配置和账号入口。", icon: Settings },
] as const;

export default async function AdminHomePage() {
  await requireAdmin();

  const [tenants, users, stores, actions] = await Promise.all([
    prisma.tenant.count(),
    prisma.user.count(),
    prisma.store.count(),
    prisma.agentAction.count({
      where: { status: "PENDING_APPROVAL" },
    }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader title="平台后台" description="管理员入口集中到这里，客户使用页面不再展示后台配置项。" />

      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard title="租户" value={tenants} icon={<Users className="h-4 w-4" aria-hidden="true" />} />
        <MetricCard title="用户" value={users} tone="green" icon={<ShieldCheck className="h-4 w-4" aria-hidden="true" />} />
        <MetricCard title="店铺" value={stores} tone="violet" icon={<Store className="h-4 w-4" aria-hidden="true" />} />
        <MetricCard title="待审批" value={actions} tone="amber" icon={<FileCheck2 className="h-4 w-4" aria-hidden="true" />} />
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {adminLinks.map((item) => {
          const Icon = item.icon;
          return (
            <Link key={item.href} href={item.href} className="block">
              <Card className="h-full p-4 transition-all hover:-translate-y-0.5 hover:shadow-[0_14px_34px_rgba(48,78,124,0.12)]">
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#eaf1ff] text-[#2465dd]">
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <span>
                    <span className="block text-sm font-bold text-[#17223d]">{item.title}</span>
                    <span className="mt-1 block text-sm leading-6 text-[#687790]">{item.description}</span>
                  </span>
                </div>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
