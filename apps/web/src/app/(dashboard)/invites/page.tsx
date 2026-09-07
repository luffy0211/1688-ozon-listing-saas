import Link from "next/link";
import { prisma } from "@saas/db";
import { requireUser } from "@/lib/auth";
import { Badge, Card, EmptyState, PageHeader, SectionHeader, Table } from "@/components/ui";
import { InviteForm } from "@/components/api-actions";

export default async function InvitesPage() {
  const user = await requireUser();
  if (!user.tenantId) {
    return <PageHeader title="邀请码" description="管理员账号请进入平台管理。" />;
  }

  const invites = await prisma.invite.findMany({
    where: { tenantId: user.tenantId },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="space-y-6">
      <PageHeader title="邀请码" description="用于团队成员注册。默认种子邀请码是 dev-invite。">
        <Link href="/settings" className="inline-flex h-9 items-center rounded-xl border border-[#d8e4f2] bg-white px-3 text-sm font-medium text-gray-700 hover:bg-[#f7faff]">
          返回配置中心
        </Link>
      </PageHeader>
      <Card>
        <SectionHeader title="生成邀请码" />
        <InviteForm />
      </Card>
      {invites.length === 0 ? (
        <EmptyState title="暂无邀请码" />
      ) : (
        <Table head={["邀请码", "角色", "使用次数", "过期时间", "创建时间"]}>
          {invites.map((invite) => (
            <tr key={invite.id} className="hover:bg-gray-50">
              <td className="px-4 py-3 font-mono text-sm">{invite.code}</td>
              <td className="px-4 py-3"><Badge>{invite.role}</Badge></td>
              <td className="px-4 py-3">{invite.usedCount} / {invite.maxUses}</td>
              <td className="px-4 py-3">{invite.expiresAt?.toLocaleString("zh-CN") ?? "-"}</td>
              <td className="px-4 py-3 text-gray-500">{invite.createdAt.toLocaleString("zh-CN")}</td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}
