// The shared group haste burst behind Bloodlust (War Drums) and Temporal
// Acceleration: a short, powerful haste window on the caster's allies, gated by a
// common exhaustion so the two can never be chained.
//
// Full haste means both channels: buff_haste (attack/swing speed, value = the
// multiplier) AND, when `spell` is set, buff_spellhaste (casts and channels, value =
// multiplier - 1, the additive bonus spellHasteMult reads). When `exhaust` is set it
// applies the `sated` debuff and refuses the buff to anyone already sated, so a second
// burst (even from another caster) gives them nothing until it fades.
//
// `src/sim`-pure: no DOM/Three/render/ui/game/net imports, no Math.random/Date.now.

import type { SimContext } from '../sim_context';
import type { Aura, Entity } from '../types';
import { livingGroupRaidInRadius } from './group_targeting';

// The shared exhaustion debuff. Owner 2026-07-13: 10 minutes, so a raid gets one
// haste burst per 10 min no matter how many Bloodlust/Temporal Acceleration casters
// are present (longer than either 5 min cooldown, the classic Sated feel). Tunable.
export const SATED_ID = 'sated';
export const SATED_NAME = 'Temporal Exhaustion';
export const SATED_DURATION = 600;

export interface GroupHasteParams {
  mult: number; // e.g. 1.3 for +30%
  duration: number; // seconds the haste lasts
  radius: number; // yards
  spell?: boolean; // also grant spell/channel haste (full haste)
  exhaust?: boolean; // apply/gate the shared `sated` debuff
  groupOnly?: boolean; // restrict to the caster's living group/raid
}

// Apply the group haste burst from `caster`. Returns the entities actually buffed
// (sated targets are skipped when `exhaust` is set). Draws no rng.
export function applyGroupHaste(
  ctx: SimContext,
  caster: Entity,
  p: GroupHasteParams,
  abilityId: string,
  abilityName: string,
  school: Aura['school'],
): Entity[] {
  const targets = p.groupOnly
    ? livingGroupRaidInRadius(ctx, caster, p.radius)
    : ctx.friendliesInRadius(caster, caster.pos, p.radius);
  const buffed: Entity[] = [];
  for (const target of targets) {
    // Shared exhaustion: a target already sated cannot benefit from another burst.
    if (p.exhaust && target.auras.some((a) => a.kind === 'sated')) continue;
    ctx.applyAura(target, {
      id: abilityId,
      name: abilityName,
      kind: 'buff_haste',
      remaining: p.duration,
      duration: p.duration,
      value: p.mult,
      sourceId: caster.id,
      school,
    });
    if (p.spell) {
      ctx.applyAura(target, {
        id: `${abilityId}_spell`,
        name: abilityName,
        kind: 'buff_spellhaste',
        remaining: p.duration,
        duration: p.duration,
        value: p.mult - 1, // spellHasteMult reads an ADDITIVE bonus, not a multiplier
        sourceId: caster.id,
        school,
      });
    }
    if (p.exhaust) {
      ctx.applyAura(target, {
        id: SATED_ID,
        name: SATED_NAME,
        kind: 'sated',
        remaining: SATED_DURATION,
        duration: SATED_DURATION,
        value: 0,
        sourceId: caster.id,
        school,
      });
    }
    buffed.push(target);
  }
  return buffed;
}
