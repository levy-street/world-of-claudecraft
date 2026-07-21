import { prisma } from './db';

// SystemConfig-backed runtime flags. Kept tiny - this is an ops kill switch,
// not a feature-flag system.

const ROUTING_PAUSED_KEY = 'routing_paused';

// Short TTL cache so the kill-switch check doesn't cost a DB round-trip on
// every inference. globalThis because Next.js can instantiate this module
// once per route bundle; the toggle route must invalidate the copy the
// inference route reads. Cross-instance propagation is bounded by the TTL.
const KILL_SWITCH_TTL_MS = 2_000;
const globalState = globalThis as unknown as {
  killSwitchCache?: { at: number; paused: boolean } | null;
};

export async function isRoutingPaused(): Promise<boolean> {
  const cached = globalState.killSwitchCache;
  if (cached && Date.now() - cached.at < KILL_SWITCH_TTL_MS) return cached.paused;
  const row = await prisma.systemConfig.findUnique({ where: { key: ROUTING_PAUSED_KEY } });
  const paused = row?.value === 'true';
  globalState.killSwitchCache = { at: Date.now(), paused };
  return paused;
}

export async function setRoutingPaused(paused: boolean): Promise<void> {
  await prisma.systemConfig.upsert({
    where: { key: ROUTING_PAUSED_KEY },
    create: { key: ROUTING_PAUSED_KEY, value: String(paused) },
    update: { value: String(paused) },
  });
  globalState.killSwitchCache = { at: Date.now(), paused };
}
