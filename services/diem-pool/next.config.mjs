/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Prisma and BullMQ ship native/runtime pieces that must not be bundled.
  experimental: {
    serverComponentsExternalPackages: ['@prisma/client', 'bullmq', 'ioredis'],
  },
};

export default nextConfig;
