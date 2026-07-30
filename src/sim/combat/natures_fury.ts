// Nature's Fury (druid level-20 row, the maintainer design that replaced
// Storm Refrain): while a druid with the talent is in Moonwing Form, they and
// their party members within range carry a small spell-crit aura
// (buff_spellcrit, read by the shared spellCrit path). Pulsed on a short
// refresh (the Rune of Power idiom): leaving form or drifting out of range
// lets the aura lapse within its window. Deterministic, draws no rng.

import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import { dist2d, type Entity } from '../types';

export const NATURES_FURY_ID = 'natures_fury';
const NATURES_FURY_RADIUS_YD = 30;
// Re-apply once a second (staggered by pid so parties do not pulse in the
// same tick); each pulse carries a 3s window so a missed pulse never flickers.
const PULSE_EVERY_TICKS = 20;
const REFRESH_SECONDS = 3;

export function tickNaturesFury(ctx: SimContext, p: Entity, meta: PlayerMeta): void {
  const pct = ctx.playerMods(meta).global.moonwingPartyCritPct;
  if (pct <= 0) return;
  if (!p.auras.some((aura) => aura.kind === 'form_moonkin')) return;
  if (ctx.tickCount % PULSE_EVERY_TICKS !== p.id % PULSE_EVERY_TICKS) return;
  const apply = (target: Entity): void => {
    // A pulse this cadence just extends an aura that is already up: refresh the
    // window in place rather than round-tripping through applyAura, which would
    // re-fire an 'aura' gained:true SimEvent (buff-gained FCT/SFX) every second
    // even though nothing actually changed for the player.
    const existing = target.auras.find(
      (aura) => aura.id === NATURES_FURY_ID && aura.sourceId === p.id,
    );
    if (existing) {
      existing.remaining = REFRESH_SECONDS;
      existing.duration = REFRESH_SECONDS;
      existing.value = pct;
      return;
    }
    ctx.applyAura(target, {
      id: NATURES_FURY_ID,
      name: "Nature's Fury",
      kind: 'buff_spellcrit',
      remaining: REFRESH_SECONDS,
      duration: REFRESH_SECONDS,
      value: pct,
      sourceId: p.id,
      school: 'nature',
    });
  };
  apply(p);
  const party = ctx.partyOf(p.id);
  if (!party) return;
  for (const memberPid of party.members) {
    if (memberPid === p.id) continue;
    const member = ctx.entities.get(memberPid);
    if (!member || member.dead) continue;
    if (dist2d(p.pos, member.pos) > NATURES_FURY_RADIUS_YD) continue;
    apply(member);
  }
}
