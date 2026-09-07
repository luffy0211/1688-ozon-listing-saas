import Link from "next/link";
import { prisma } from "@saas/db";
import { requireUser } from "@/lib/auth";
import { Badge, Card, EmptyState, PageHeader, SectionHeader, Table } from "@/components/ui";
import { StoreForm } from "@/components/api-actions";

export default async function StoresPage() {
  const user = await requireUser();
  if (!user.tenantId) {
    return <PageHeader title="Ozon 店铺" description="管理员账号请进入平台管理。" />;
  }

  const stores = await prisma.store.findMany({
    where: { tenantId: user.tenantId },
    orderBy: { createdAt: "asc" },
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Ozon 店铺" description="配置用于生成草稿和提交上架的 Ozon API 信息。">
        <Link href="/settings" className="inline-flex h-9 items-center rounded-xl border border-[#d8e4f2] bg-white px-3 text-sm font-medium text-gray-700 hover:bg-[#f7faff]">
          返回配置中心
        </Link>
      </PageHeader>
      <Card>
        <SectionHeader title="新增或更新店铺" description="同名店铺会更新密钥和默认状态；API Key 会加密保存。" />
        <StoreForm />
      </Card>
      {stores.length === 0 ? (
        <EmptyState title="暂无 Ozon 店铺" description="配置店铺后，商品才能生成对应店铺的 Ozon 草稿。" />
      ) : (
        <Table head={["店铺", "Client ID", "API Key", "翻译供应商", "默认"]}>
          {stores.map((store) => (
            <tr key={store.id} className="hover:bg-gray-50">
              <td className="px-4 py-3 font-medium text-gray-950">{store.name}</td>
              <td className="px-4 py-3">{store.ozonClientId}</td>
              <td className="px-4 py-3">****</td>
              <td className="px-4 py-3">{store.translationVendor}</td>
              <td className="px-4 py-3">{store.isDefault ? <Badge tone="green">默认</Badge> : "-"}</td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}
