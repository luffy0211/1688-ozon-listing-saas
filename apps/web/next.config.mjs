/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [
    "@saas/db",
    "@saas/core",
    "@saas/ozon",
    "@saas/xiangji",
    "@saas/storage",
  ],
  serverExternalPackages: ["@prisma/client", "bullmq", "ioredis", "playwright"],
  allowedDevOrigins: ["127.0.0.1"],
  reactStrictMode: true,
};

export default nextConfig;
