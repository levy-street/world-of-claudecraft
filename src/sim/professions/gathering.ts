// Gathering profession proficiency: state shape + gain logic, behind the
// SimContext seam. The backing counters live on PlayerMeta (sim.ts); this
// module holds the pure functions. Each gathering profession is an
// independent, additive counter: granting one never touches another (no
// shared/conserved pool). No world nodes exist yet (see issue #1119), so the
// only producer today is the ALLOW_DEV_COMMANDS `/dev gather` chat cheat
// (src/sim/social/chat.ts), which QUEUES a grant here; the queue is drained
// once per player during the normal 20 Hz tick loop (sim.ts `tick()`, next to
// `updateRested`), so a grant only ever takes effect on the deterministic tick
// path, never out of band.

import {
  GATHERING_PROFESSION_IDS,
  GATHERING_PROFESSIONS,
  type GatheringProfessionId,
} from '../content/professions';
import type { PlayerMeta } from '../sim';
import type { PlayerProfessionSkill } from './types';

export type GatheringProficiency = Record<GatheringProfessionId, number>;

export interface PendingGatherGrant {
  professionId: GatheringProfessionId;
  amount: number;
}

export function emptyGatheringProficiency(): GatheringProficiency {
  return { mining: 0, logging: 0, herbalism: 0 };
}

export function isGatheringProfessionId(id: string): id is GatheringProfessionId {
  return (GATHERING_PROFESSION_IDS as string[]).includes(id);
}

// Normalizes a possibly-absent, possibly-partial saved record (old character
// saves predate this field entirely) into a full, zero-defaulted proficiency
// record. Never throws on an absent or malformed field.
export function normalizeGatheringProficiency(
  saved: Partial<Record<string, number>> | undefined | null,
): GatheringProficiency {
  const out = emptyGatheringProficiency();
  if (!saved) return out;
  for (const id of GATHERING_PROFESSION_IDS) {
    const v = saved[id];
    if (typeof v === 'number' && Number.isFinite(v)) out[id] = Math.max(0, v);
  }
  return out;
}

// Queues a grant for the next tick's drain; called from the `/dev gather`
// chat cheat (offline local play or ALLOW_DEV_COMMANDS=1 on the server). No
// rng draw: the amount is a fixed value passed by the caller, so the result is
// fully deterministic given the same sequence of calls. Proficiency is a
// monotonic additive-only counter (no decrement path), so a non-positive
// amount is rejected here rather than silently applied as a decrement by
// drainGatheringGrants.
export function queueGatheringGrant(
  meta: PlayerMeta,
  professionId: GatheringProfessionId,
  amount: number,
): void {
  if (!Number.isFinite(amount) || amount <= 0) return;
  meta.pendingGatherGrants.push({ professionId, amount });
}

// Drains one player's queued grants, applying each additively to that
// profession's own counter only. Called once per player per tick (sim.ts
// `tick()`), so a grant issued this tick is visible starting next tick, the
// same cadence as every other per-tick system.
export function drainGatheringGrants(meta: PlayerMeta): void {
  if (meta.pendingGatherGrants.length === 0) return;
  for (const grant of meta.pendingGatherGrants) {
    meta.gatheringProficiency[grant.professionId] = Math.max(
      0,
      meta.gatheringProficiency[grant.professionId] + grant.amount,
    );
  }
  meta.pendingGatherGrants.length = 0;
}

// Projects the internal per-profession counter onto the settled
// `PlayerProfessionSkill` shape (src/sim/professions/types.ts, from #1164),
// in the stable GATHERING_PROFESSION_IDS order. This is what backs the
// `IWorldProfessions.professionsState` read (sim.ts `professionsStateFor`);
// crafting/secondary professions still contribute nothing until they land.
export function gatheringSkillsView(proficiency: GatheringProficiency): PlayerProfessionSkill[] {
  return GATHERING_PROFESSION_IDS.map((id) => ({
    professionId: id,
    skill: proficiency[id],
    maxSkill: GATHERING_PROFESSIONS[id].maxSkill,
  }));
}
