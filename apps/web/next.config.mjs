/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [
    "@saas/db",
    "@saas/core",
    "@saas/ozon",
    "@saas/xiangji",
    "@saas/storage",
  ],
  experimental: {
    serverComponentsExternalPackages: ["@prisma/client", "bullmq", "ioredis", "playwright"],
  },
  reactStrictMode: true,
};

export default nextConfig;
