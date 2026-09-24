import Link from "next/link";
import { Coins, ShieldCheck, Store, Users } from "lucide-react";
import { prisma } from "@saas/db";
import { Card, MetricCard, PageHeader } from "@/components/ui";

const adminLinks = [
  { href: "/admin/tenants", title: "租户管理", description: "查看客户、用户、店铺和任务数量。", icon: Users },
  { href: "/admin/credits", title: "积分管理", description: "给客户加减积分，查看积分流水。", icon: Coins },
] as const;

export default async function AdminHomePage() {
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
      <PageHeader title="平台后台" description="管理租户、积分和平台运行状态。" />

      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard title="租户" value={tenants} icon={<Users className="h-4 w-4" aria-hidden="true" />} />
        <MetricCard title="用户" value={users} tone="green" icon={<ShieldCheck className="h-4 w-4" aria-hidden="true" />} />
        <MetricCard title="店铺" value={stores} tone="violet" icon={<Store className="h-4 w-4" aria-hidden="true" />} />
        <MetricCard title="待审批" value={actions} tone="amber" icon={<ShieldCheck className="h-4 w-4" aria-hidden="true" />} />
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
