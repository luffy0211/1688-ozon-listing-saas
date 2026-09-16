import Link from "next/link";
import { prisma } from "@saas/db";
import { requireUser } from "@/lib/auth";
import { Card, EmptyState, PageHeader, SectionHeader, Table } from "@/components/ui";
import { XiangjiForm } from "@/components/api-actions";

export default async function XiangjiSettingsPage() {
  const user = await requireUser();
  if (!user.tenantId) {
    return <PageHeader title="象寄配置" description="管理员账号请进入平台管理。" />;
  }

  const credentials = await prisma.xiangjiCredential.findMany({
    where: { tenantId: user.tenantId },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="space-y-6">
      <PageHeader title="象寄配置" description="保存翻译和图片处理使用的 X-API-Key。">
        <Link href="/settings" className="inline-flex h-9 items-center rounded-xl border border-[#d8e4f2] bg-white px-3 text-sm font-medium text-gray-700 hover:bg-[#f7faff]">
          返回配置中心
        </Link>
      </PageHeader>
      <Card>
        <SectionHeader title="新增 Key" description="Key 会加密保存，API 不返回明文。" />
        <XiangjiForm />
      </Card>
      {credentials.length === 0 ? (
        <EmptyState title="暂无象寄 Key" description="未配置时只能使用 mock 翻译和 mock 图片流程。" />
      ) : (
        <Table head={["名称", "API Key", "创建时间"]}>
          {credentials.map((cred) => (
            <tr key={cred.id} className="hover:bg-gray-50">
              <td className="px-4 py-3">{cred.name ?? "-"}</td>
              <td className="px-4 py-3">****</td>
              <td className="px-4 py-3 text-gray-500">{cred.createdAt.toLocaleString("zh-CN")}</td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}
