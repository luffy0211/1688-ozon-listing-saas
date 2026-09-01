import Link from "next/link";
import { KeyRound, Percent, ShieldCheck, Store, Ticket, WandSparkles } from "lucide-react";
import { prisma } from "@saas/db";
import { requireUser } from "@/lib/auth";
import { Badge, Card, PageHeader, ProgressBar, SectionHeader } from "@/components/ui";

const baseGroups = [
  {
    title: "账号接入",
    description: "这些配置决定系统能不能采集、翻译和提交草稿。",
    links: [
      {
        href: "/1688-credentials",
        title: "1688 登录信息",
        description: "保存采集店铺和商品详情用的 Cookie。",
        icon: KeyRound,
      },
      {
        href: "/stores",
        title: "Ozon 店铺",
        description: "保存 Ozon Client ID、API Key 和默认店铺。",
        icon: Store,
      },
      {
        href: "/xiangji-settings",
        title: "象寄 Key",
        description: "保存翻译和详情图处理所需的接口 Key。",
        icon: WandSparkles,
      },
    ],
  },
  {
    title: "上架规则",
    description: "这些规则会影响草稿价格和后续发布确认。",
    links: [
      {
        href: "/pricing-rules",
        title: "定价规则",
        description: "配置采购价、物流、佣金和目标毛利。",
        icon: Percent,
      },
    ],
  },
  {
    title: "团队",
    description: "低频管理操作集中放在这里。",
    links: [
      {
        href: "/invites",
        title: "邀请码",
        description: "给团队成员生成注册邀请码。",
        icon: Ticket,
      },
    ],
  },
];

export default async function SettingsPage() {
  const user = await requireUser();
  const tenantId = user.tenantId;

  if (!tenantId) {
    return <PageHeader title="设置" description="管理员账号请进入平台管理。" />;
  }

  const [storeCount, xiangjiCount, pricingRuleCount, source1688Count] = await Promise.all([
    prisma.store.count({ where: { tenantId } }),
    prisma.xiangjiCredential.count({ where: { tenantId } }),
    prisma.pricingRule.count({ where: { tenantId } }),
    prisma.source1688Credential.count({ where: { tenantId } }),
  ]);

  const checks = [
    { label: "1688 登录", ready: source1688Count > 0 },
    { label: "Ozon 店铺", ready: storeCount > 0 },
    { label: "象寄 Key", ready: xiangjiCount > 0 },
    { label: "定价规则", ready: pricingRuleCount > 0 },
  ];
  const readyCount = checks.filter((item) => item.ready).length;
  const readiness = Math.round((readyCount / checks.length) * 100);
  const groups = user.role === "admin"
    ? [
        ...baseGroups,
        {
          title: "平台",
          description: "仅管理员可见。",
          links: [
            {
              href: "/admin/tenants",
              title: "平台管理",
              description: "查看租户、用户、店铺、商品和任务数量。",
              icon: ShieldCheck,
            },
          ],
        },
      ]
    : baseGroups;

  return (
    <div className="space-y-6">
      <PageHeader
        title="设置"
        description="集中维护账号、规则和团队配置。日常操作请回到工作台、采集选品、商品池和待发布页面。"
      >
        <Link className="inline-flex h-9 items-center rounded-md border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 hover:bg-gray-50" href="/dashboard">
          返回工作台
        </Link>
      </PageHeader>

      <Card>
        <SectionHeader title="系统可用性" description="不是每天都要配置；这里用于判断系统是否已经具备完整上架能力。" />
        <div className="grid gap-4 md:grid-cols-[260px_minmax(0,1fr)] md:items-center">
          <div>
            <div className="text-3xl font-semibold text-gray-950">{readiness}%</div>
            <p className="mt-1 text-sm text-gray-500">{readyCount} / {checks.length} 项已完成</p>
            <div className="mt-4">
              <ProgressBar value={readiness} />
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {checks.map((item) => (
              <div key={item.label} className="flex items-center justify-between rounded-md border border-gray-200 px-3 py-2">
                <span className="text-sm font-medium text-gray-700">{item.label}</span>
                <Badge tone={item.ready ? "green" : "amber"}>{item.ready ? "已完成" : "待设置"}</Badge>
              </div>
            ))}
          </div>
        </div>
      </Card>

      {groups.map((group) => (
        <section key={group.title} className="space-y-3">
          <SectionHeader title={group.title} description={group.description} />
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {group.links.map((item) => {
              const Icon = item.icon;
              return (
                <Link key={item.href} href={item.href} className="group">
                  <Card className="h-full transition-shadow group-hover:shadow-md">
                    <div className="flex items-start gap-3">
                      <div className="rounded-md bg-blue-50 p-2 text-blue-700">
                        <Icon className="h-4 w-4" aria-hidden="true" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-gray-950">{item.title}</h3>
                        <p className="mt-1 text-sm leading-6 text-gray-500">{item.description}</p>
                      </div>
                    </div>
                  </Card>
                </Link>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
