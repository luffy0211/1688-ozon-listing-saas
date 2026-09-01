import Link from "next/link";
import { prisma } from "@saas/db";
import { requireUser } from "@/lib/auth";
import { Card, PageHeader, SectionHeader } from "@/components/ui";
import {
  Source1688CookieForm,
  type Source1688CredentialView,
} from "@/components/api-actions";

export default async function Source1688CredentialsPage() {
  const user = await requireUser();
  const tenantId = user.tenantId;

  if (!tenantId) {
    return <PageHeader title="1688 登录信息" description="管理员账号请进入平台管理。" />;
  }

  const credentials = await prisma.source1688Credential.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
  });

  const credentialViews: Source1688CredentialView[] = credentials.map((cred) => ({
    id: cred.id,
    name: cred.name,
    status: cred.status,
    lastVerifiedAt: cred.lastVerifiedAt?.toISOString() ?? null,
    createdAt: cred.createdAt.toISOString(),
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="1688 登录信息"
        description="维护采集用 Cookie。登录信息单独配置，不混入采集、选品、上架主流程。"
      >
        <Link className="inline-flex h-9 items-center rounded-md border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 hover:bg-gray-50" href="/settings">
          返回配置中心
        </Link>
      </PageHeader>
      <Card>
        <SectionHeader title="保存 Cookie" description="Cookie 会加密保存，只用于服务端采集 1688 店铺和商品详情。" />
        <Source1688CookieForm credentials={credentialViews} />
      </Card>
    </div>
  );
}
