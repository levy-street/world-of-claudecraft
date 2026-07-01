import { FACTIONS, REPUTATION_MAX, REPUTATION_MIN, reputationStanding } from './content/factions';
import type { PlayerMeta } from './sim';

export function normalizeReputation(
  input: Record<string, number> | undefined,
): Record<string, number> {
  const out: Record<string, number> = {};
  if (!input) return out;
  for (const [factionId, raw] of Object.entries(input)) {
    if (!FACTIONS[factionId as keyof typeof FACTIONS] || !Number.isFinite(raw)) continue;
    const value = Math.max(REPUTATION_MIN, Math.min(REPUTATION_MAX, Math.floor(raw)));
    if (value !== 0) out[factionId] = value;
  }
  return out;
}

export function grantReputation(
  meta: PlayerMeta,
  factionId: string,
  amount: number,
): { factionName: string; amount: number; total: number; standing: string } | null {
  const faction = FACTIONS[factionId as keyof typeof FACTIONS];
  if (!faction || !Number.isFinite(amount)) return null;
  const delta = Math.floor(amount);
  if (delta === 0) return null;
  const before = meta.reputation[factionId] ?? 0;
  const total = Math.max(REPUTATION_MIN, Math.min(REPUTATION_MAX, before + delta));
  const applied = total - before;
  if (applied === 0) return null;
  if (total === 0) delete meta.reputation[factionId];
  else meta.reputation[factionId] = total;
  return { factionName: faction.name, amount: applied, total, standing: reputationStanding(total) };
}
