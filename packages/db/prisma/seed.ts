import { PrismaClient } from "@prisma/client";
import { randomBytes, scryptSync } from "node:crypto";

const prisma = new PrismaClient();

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

async function main() {
  const tenantName = process.env.SEED_TENANT_NAME ?? "本地演示租户";
  const customerEmail = process.env.SEED_USER_EMAIL ?? process.env.SEED_ADMIN_EMAIL ?? "admin@example.com";
  const customerPassword = process.env.SEED_USER_PASSWORD ?? process.env.SEED_ADMIN_PASSWORD ?? "Admin123456";
  const platformAdminEmail = process.env.SEED_PLATFORM_ADMIN_EMAIL ?? "platform-admin@example.com";
  const platformAdminPassword = process.env.SEED_PLATFORM_ADMIN_PASSWORD ?? "Admin123456";
  const inviteCode = process.env.INITIAL_INVITE_CODE ?? "dev-invite";

  if (customerEmail === platformAdminEmail) {
    throw new Error("SEED_USER_EMAIL and SEED_PLATFORM_ADMIN_EMAIL must be different");
  }

  const tenant = await prisma.tenant.upsert({
    where: { id: "local-demo-tenant" },
    update: { name: tenantName },
    create: { id: "local-demo-tenant", name: tenantName },
  });

  await prisma.user.upsert({
    where: { email: customerEmail },
    update: {
      name: "本地客户",
      role: "owner",
      tenantId: tenant.id,
    },
    create: {
      email: customerEmail,
      passwordHash: hashPassword(customerPassword),
      name: "本地客户",
      role: "owner",
      tenantId: tenant.id,
    },
  });

  await prisma.user.upsert({
    where: { email: platformAdminEmail },
    update: {
      name: "平台管理员",
      role: "admin",
      tenantId: tenant.id,
    },
    create: {
      email: platformAdminEmail,
      passwordHash: hashPassword(platformAdminPassword),
      name: "平台管理员",
      role: "admin",
      tenantId: tenant.id,
    },
  });

  await prisma.invite.upsert({
    where: { code: inviteCode },
    update: {
      tenantId: tenant.id,
      role: "owner",
      maxUses: 100,
    },
    create: {
      tenantId: tenant.id,
      code: inviteCode,
      role: "owner",
      maxUses: 100,
    },
  });

  await prisma.pricingRule.upsert({
    where: { id: "local-default-pricing" },
    update: {},
    create: {
      id: "local-default-pricing",
      tenantId: tenant.id,
      name: "默认定价规则",
      domesticShippingCny: 0,
      packagingCny: 1,
      cnyToRub: 12,
      internationalShippingRub: 120,
      commissionRate: 0.15,
      targetMarginRate: 0.2,
      isDefault: true,
    },
  });

  console.log(`Seed complete: user=${customerEmail}, platformAdmin=${platformAdminEmail}, invite=${inviteCode}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
