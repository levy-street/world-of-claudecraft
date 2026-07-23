// Spell Power scaling: the pure, host-agnostic coefficient math that turns a
// caster's Spell Power (or an attacker's Attack Power, for "attack spells") into
// the flat amount added to a spell hit, heal, absorb, channel tick, DoT tick,
// or AoE hit.
//
// Classic-era model:
//   - direct nuke: coeff = clamp(castTime, 1.5, 7) / 3.5 (instants use the 1.5 floor)
//   - channel:     coeff = clamp(channelDuration, 1.5, 7) / 3.5, split across ticks
//   - DoT:         coeff = duration / 15 (total), split across ticks
//   - AoE:         the direct coeff times an AoE penalty (0.333)
// Attack-power "attack spells" reuse the same shape, scaled down (RANGED_/
// MELEE_SPELL_AP_SCALE) because Attack Power is a much larger number than Spell
// Power: hunter shots use Ranged AP, physical melee specials use melee AP.
//
// These functions take plain numbers (and the ability def), never the Sim, so they
// are unit-tested directly (tests/spell_scaling.test.ts) and reused by the damage
// sites in combat/effect_dispatch.ts, combat/casting_lifecycle.ts, and sim.ts.

import type { AbilityDef, Entity } from './types';
import {
  MELEE_SPELL_AP_SCALE,
  RANGED_SPELL_AP_SCALE,
  SPELL_AOE_COEFF_MULT,
  SPELL_COEFF_DIVISOR,
  SPELL_COEFF_MAX_CAST,
  SPELL_COEFF_MIN_CAST,
  SPELL_DOT_COEFF_DURATION,
} from './types';

function clampCast(seconds: number): number {
  const t = seconds <= 0 ? SPELL_COEFF_MIN_CAST : seconds;
  return Math.min(SPELL_COEFF_MAX_CAST, Math.max(SPELL_COEFF_MIN_CAST, t));
}

// Direct-damage coefficient for one cast (cast time in seconds; 0 = instant).
export function directSpellCoeff(castTimeSec: number): number {
  return clampCast(castTimeSec) / SPELL_COEFF_DIVISOR;
}

// Total channel coefficient (spread across ticks by the caller).
export function channelSpellCoeff(channelDurationSec: number): number {
  return clampCast(channelDurationSec) / SPELL_COEFF_DIVISOR;
}

// Total DoT coefficient over the whole duration (spread across ticks by the caller).
export function dotTotalCoeff(durationSec: number): number {
  return durationSec / SPELL_DOT_COEFF_DURATION;
}

// The scaling stat for an ability: Ranged Attack Power for hunter attack-spells,
// melee Attack Power for physical-school specials, otherwise Spell Power. Reads
// only the three derived combat ratings off the entity.
export function abilityScalingPower(
  e: Pick<Entity, 'spellPower' | 'rangedPower' | 'attackPower'>,
  def: AbilityDef,
): number {
  if (def.scalesWith === 'ranged') return e.rangedPower;
  if (def.school === 'physical') return e.attackPower;
  return e.spellPower;
}

// The AP-vs-SP scale-down for the flat rider: Ranged AP and melee AP are far
// larger than Spell Power, so their attack-spells take a fraction of the
// coefficient; true Spell Power spells use the full coefficient (1).
function powerScale(def: AbilityDef): number {
  if (def.scalesWith === 'ranged') return RANGED_SPELL_AP_SCALE;
  if (def.school === 'physical') return MELEE_SPELL_AP_SCALE;
  return 1;
}

// Flat bonus added to ONE direct (or AoE) spell hit. `castTimeSec` is the
// rank-resolved cast time (res.castTime), NOT the rank-1 base def.castTime, so
// higher ranks (and talent-hastened casts) scale correctly. `aoe` applies the
// AoE penalty.
export function directHitBonus(
  power: number,
  def: AbilityDef,
  castTimeSec: number,
  aoe = false,
): number {
  const coeff = directSpellCoeff(castTimeSec) * (aoe ? SPELL_AOE_COEFF_MULT : 1);
  return Math.round(power * coeff * powerScale(def));
}

// Flat bonus added to ONE direct heal. Healing always scales off Spell Power at
// the full cast-time coefficient with no AP scale-down (heals are never "attack
// spells"): instants use the 1.5 floor, like a direct nuke. `castTimeSec` is the
// rank-resolved cast time (res.castTime), so higher ranks and talent-hastened
// heals scale correctly. `aoe` applies the same per-target coefficient penalty
// AoE damage takes, so multi-target heals do not triple-dip Spell Power.
export function directHealBonus(spellPower: number, castTimeSec: number, aoe = false): number {
  return Math.round(spellPower * directSpellCoeff(castTimeSec) * (aoe ? SPELL_AOE_COEFF_MULT : 1));
}

// Flat bonus added to an absorb shield with an explicitly authored coefficient.
// Shields without a coefficient remain fixed by rank.
export function absorbBonus(spellPower: number, coefficient: number): number {
  return Math.max(0, Math.round(spellPower * coefficient));
}

// Flat bonus added to ONE HoT tick: the total DoT coefficient (duration / 15)
// split across its ticks, scaling off Spell Power. Mirrors dotTickBonus but never
// takes the AP scale-down, since HoTs are pure healing.
export function hotTickBonus(spellPower: number, durationSec: number, intervalSec: number): number {
  const ticks = intervalSec > 0 ? Math.max(1, durationSec / intervalSec) : 1;
  const coeff = dotTotalCoeff(durationSec) / ticks;
  return Math.round(spellPower * coeff);
}

// Flat bonus added to ONE channel tick (e.g. each Arcane Missile / Mind Flay tick).
export function channelTickBonus(power: number, def: AbilityDef): number {
  const ch = def.channel;
  if (!ch || ch.ticks <= 0) return 0;
  const coeff = channelSpellCoeff(ch.duration) / ch.ticks;
  return Math.round(power * coeff * powerScale(def));
}

// Flat bonus added to ONE DoT tick (total DoT coefficient split across its ticks).
export function dotTickBonus(
  power: number,
  def: AbilityDef,
  durationSec: number,
  intervalSec: number,
): number {
  const ticks = intervalSec > 0 ? Math.max(1, durationSec / intervalSec) : 1;
  const coeff = dotTotalCoeff(durationSec) / ticks;
  return Math.round(power * coeff * powerScale(def));
}
