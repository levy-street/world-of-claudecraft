// The long-buff VFX policy: a buff worn for LONG_BUFF_VFX_SECONDS or more is
// SILENT while held: no orbit band, no ground disc, no held barrier shell,
// and no sustained transformative body rim.
// Cast-moment feedback (the gain swirl, shell flash, linger) stays. Rationale:
// a 30 minute stat buff communicates nothing actionable, and a raid wearing
// five of them each is unreadable noise (the star halos / heartbeat rings /
// ground discs pile-up). The threshold is safe because the content has a
// natural gap: every buff aura is authored at <= 60s (barriers, procs,
// cooldowns, all actionable) or >= 300s (raid buffs, aspects, imbues, forms).
// Exceptions are explicit, never implicit: morph/veil styles are identity
// states (shapeshift forms, shadowform, stealth) and keep their reads, and an
// authored buff.persist opts a spec out. Pure and host-agnostic: the duration
// comes from the static ability content, so all three hosts agree by
// construction. tests/ability_vfx_longbuff_core.test.ts pins the exact
// silenced set; the painter consumes this in its aura scan.
import { ABILITIES } from '../sim/data';
import type { AbilityVfxFullSpec } from './ability_vfx_core';

export const LONG_BUFF_VFX_SECONDS = 300;

const durationMemo = new Map<string, number>();

// The longest aura a cast of this ability can leave on a friendly wearer, in
// seconds, across the base effect rows and every rank row. 0 when the ability
// is unknown or grants no timed aura (an unknown id must never be silenced).
export function buffAuraDurationSec(abilityId: string): number {
  const memo = durationMemo.get(abilityId);
  if (memo !== undefined) return memo;
  const def = ABILITIES[abilityId];
  let max = 0;
  if (def !== undefined) {
    const rows = [def.effects];
    if (def.ranks !== undefined) for (const r of def.ranks) rows.push(r.effects);
    for (const effects of rows) {
      for (const eff of effects) {
        switch (eff.type) {
          case 'selfBuff':
          case 'buffTarget':
          case 'imbue':
          case 'absorb':
          case 'aoeAllyAttackPower':
          case 'aoeAllyHaste':
          case 'aoeAllyAbsorb':
            if (eff.duration > max) max = eff.duration;
            break;
        }
      }
    }
  }
  durationMemo.set(abilityId, max);
  return max;
}

// Whether this aura keeps its persistent primitives (orbit band, ground disc,
// held shell) while worn. False = the painter shows the gain moment only.
export function holdsBuffVfxWhileWorn(
  abilityId: string,
  full: AbilityVfxFullSpec | undefined,
): boolean {
  const style = full?.buff?.style;
  if (style === 'morph' || style === 'veil') return true;
  if (full?.buff?.persist === true) return true;
  return buffAuraDurationSec(abilityId) < LONG_BUFF_VFX_SECONDS;
}
