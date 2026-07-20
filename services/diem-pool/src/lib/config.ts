import { prisma } from './db';

// SystemConfig-backed runtime flags. Kept tiny — this is an ops kill switch,
// not a feature-flag system.

export const ROUTING_PAUSED_KEY = 'routing_paused';

export async function isRoutingPaused(): Promise<boolean> {
  const row = await prisma.systemConfig.findUnique({ where: { key: ROUTING_PAUSED_KEY } });
  return row?.value === 'true';
}

export async function setRoutingPaused(paused: boolean): Promise<void> {
  await prisma.systemConfig.upsert({
    where: { key: ROUTING_PAUSED_KEY },
    create: { key: ROUTING_PAUSED_KEY, value: String(paused) },
    update: { value: String(paused) },
  });
}
