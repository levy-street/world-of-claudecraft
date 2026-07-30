// Shared group/raid targeting for self-centered support effects (Rewind's heal, the
// Bloodlust / Temporal Acceleration haste burst, ...). One deterministic resolver so
// every "buff my group/raid around me" effect scopes targets identically.
//
// `src/sim`-pure: no DOM/Three/render/ui/game/net imports, no Math.random/Date.now.

import type { SimContext } from '../sim_context';
import type { Entity } from '../types';

// Living group/raid PLAYERS within `radius` of `caster` (the caster included when in
// range); solo, just the caster. Excludes the dead, pets / NPC companions (no
// PlayerMeta), enemies, and out-of-range members. Deterministic order (by entity id);
// draws no rng.
export function livingGroupRaidInRadius(ctx: SimContext, caster: Entity, radius: number): Entity[] {
  const party = ctx.partyOf(caster.id);
  const memberIds = party ? party.members : [caster.id];
  const cx = caster.pos.x;
  const cz = caster.pos.z;
  const r2 = radius * radius;
  const out: Entity[] = [];
  for (const pid of memberIds) {
    const e = ctx.entities.get(pid);
    const meta = ctx.players.get(pid); // players only: pets / NPC companions excluded
    if (!e || !meta || e.dead) continue;
    const dx = e.pos.x - cx;
    const dz = e.pos.z - cz;
    if (dx * dx + dz * dz > r2) continue;
    out.push(e);
  }
  out.sort((a, b) => a.id - b.id);
  return out;
}
