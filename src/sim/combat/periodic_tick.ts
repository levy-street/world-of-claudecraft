// Dynamic DoT/HoT tick math: the pure, host-agnostic core that makes damage- and
// heal-over-time fully dynamic, classic-style. A DoT's per-tick damage is recomputed
// EVERY tick from the caster's CURRENT stats, so a Spell/Attack Power buff instantly
// lifts every active DoT and the damage falls back the moment it fades, no recast
// needed (the reason a DoT talent tree can keep pace with a direct-damage one). Haste
// raises the tick RATE while the duration is fixed, so a hasted DoT lands more ticks in
// the same window; crit is rolled per tick by the caller (it needs the shared Rng).
//
// These functions take plain Aura + Entity values (never the Sim), so they are
// unit-tested directly (tests/periodic_tick.test.ts) and reused by the tick loop in
// combat/auras.ts. `src/sim`-pure: no DOM/Three/render/ui/game/net imports.

import type { TickPowerStat } from '../spell_scaling';
import type { Aura, Entity } from '../types';

// The caster's live scaling rating for a periodic aura (mirrors abilityScalingPower).
function powerFor(stat: TickPowerStat, src: Entity): number {
  return stat === 'ranged' ? src.rangedPower : stat === 'melee' ? src.attackPower : src.spellPower;
}

// The caster's live haste rating matching the aura's scaling stat: ranged DoTs read
// ranged haste, physical bleeds melee haste, everything else spell haste.
function hasteFor(stat: TickPowerStat, src: Entity): number {
  return stat === 'ranged' ? src.rangedHaste : stat === 'melee' ? src.meleeHaste : src.spellHaste;
}

// Live per-tick BASE amount (pre-crit, pre-mitigation) for a dot/hot: the static
// tickBase plus the caster's CURRENT power rider, recomputed this tick. When there is
// no dynamic descriptor (mob bleeds, older auras) OR no LIVE caster to read (the caster
// logged out, or is dead but not yet removed), the tick FREEZES at the cast-time
// snapshot `value`. `value` already baked in the caster's power at cast (including the
// dotSp rider), so a frozen dot keeps paying its snapshot rather than dropping to the
// riderless tickBase. Floored at 1 like the cast-time snapshot.
export function periodicTickAmount(a: Aura, src: Entity | null): number {
  const coeff = a.tickPowerCoeff ?? 0;
  if (coeff <= 0 || !src || src.dead || !a.tickPowerStat) return Math.max(1, Math.round(a.value));
  const rider = Math.round(powerFor(a.tickPowerStat, src) * coeff);
  return Math.max(1, (a.tickBase ?? a.value) + rider);
}

// Haste-scaled tick interval: haste raises the tick RATE (interval / (1 + haste)) while
// the aura's remaining duration is untouched, so a hasted dot fires more full-damage
// ticks over the same window. A haste-less caster (and every mob source) keeps the base
// cadence exactly, so only hasted casters move off the byte-identical tick timeline. A
// gone or dead-but-not-yet-removed caster also freezes to the base cadence.
export function periodicTickInterval(a: Aura, src: Entity | null): number {
  const base = a.tickInterval ?? 0;
  if (base <= 0 || !src || src.dead || !a.tickPowerStat) return base;
  const haste = hasteFor(a.tickPowerStat, src);
  return haste > 0 ? base / (1 + haste) : base;
}

// Per-tick crit chance for a dot/hot: physical bleeds crit off the caster's melee crit,
// magic dots and all hots off spell crit (passed in, since it lives on the Sim). No live
// caster (gone, or dead but not yet removed) means no crit, so a frozen dot stops
// tracking a corpse's stat block. The caller rolls this against the shared Rng.
export function periodicCritChance(
  a: Aura,
  src: Entity | null,
  spellCrit: (e: Entity) => number,
): number {
  if (!src || src.dead) return 0;
  return a.school === 'physical' ? src.critChance : spellCrit(src);
}

// Crit multiplier for a periodic tick: physical bleeds hit for 2x (like a melee
// special), magic dots and hots for 1.5x (like a spell), matching the direct-damage
// crit multipliers in effect_dispatch.
export function periodicCritMult(a: Aura): number {
  return a.school === 'physical' ? 2 : 1.5;
}
