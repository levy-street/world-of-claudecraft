// Who is in Old Thatchgrin's fight: the one roster his whole kit aims at and strikes
// (scarecrow_kit.ts, scarecrow_swell.ts). A passer-by who never joined is never on it.
// Pure over the live entities, draws no rng.
import type { SimContext } from '../sim_context';
import type { Entity } from '../types';

/** The players in HIS fight, alive, in id order: anyone on his hate table (a pet's threat
 *  counts for its owner) or who has hurt him this pull. */
export function scarecrowFighters(ctx: SimContext, boss: Entity): Entity[] {
  const ids = new Set<number>(boss.bossDamagers);
  for (const id of boss.threat.keys()) {
    const e = ctx.entities.get(id);
    ids.add(e && e.ownerId !== null ? e.ownerId : id);
  }
  const out: Entity[] = [];
  for (const id of ids) {
    const p = ctx.entities.get(id);
    if (p && p.kind === 'player' && !p.dead) out.push(p);
  }
  return out.sort((a, b) => a.id - b.id);
}
