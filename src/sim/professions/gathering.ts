import { GATHERING_PROFESSION_IDS, type GatheringProfessionId } from '../content/professions';
import type { SimContext } from '../sim_context';

export type GatheringProficiencies = Record<GatheringProfessionId, number>;

export function emptyGatheringProficiencies(): GatheringProficiencies {
  return {
    mining: 0,
    logging: 0,
    herbalism: 0,
  };
}

export function isGatheringProfessionId(value: string): value is GatheringProfessionId {
  return (GATHERING_PROFESSION_IDS as readonly string[]).includes(value);
}

export function normalizeGatheringProficiencies(
  value: Partial<Record<string, number>> | null | undefined,
): GatheringProficiencies {
  const out = emptyGatheringProficiencies();
  if (!value) return out;
  for (const id of GATHERING_PROFESSION_IDS) {
    const n = value[id];
    out[id] = typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  }
  return out;
}

export function cloneGatheringProficiencies(value: GatheringProficiencies): GatheringProficiencies {
  return {
    mining: value.mining,
    logging: value.logging,
    herbalism: value.herbalism,
  };
}

export function gainGatheringProficiency(
  ctx: SimContext,
  professionId: GatheringProfessionId,
  amount: number,
  pid?: number,
): boolean {
  const r = ctx.resolve(pid);
  if (!r || !Number.isFinite(amount) || amount <= 0) return false;
  const delta = Math.floor(amount);
  if (delta <= 0) return false;
  r.meta.gatheringProficiencies[professionId] += delta;
  return true;
}
