import { PrismaClient } from '@prisma/client';

// Standard Next.js-safe Prisma singleton (dev hot-reload spawns many module
// instances; production gets exactly one client).

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
