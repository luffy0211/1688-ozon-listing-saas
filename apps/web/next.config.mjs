/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [
    "@saas/db",
    "@saas/core",
    "@saas/ozon",
    "@saas/xiangji",
    "@saas/storage",
  ],
  serverExternalPackages: ["@prisma/client", "bullmq", "ioredis"],
  reactStrictMode: true,
};

export default nextConfig;
