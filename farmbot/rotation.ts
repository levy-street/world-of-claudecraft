// Pure ability picking for combat.rotationMode 'auto': given the mirrored
// known-ability list (ClientWorld.known, ResolvedAbility from src/sim/sim.ts)
// and the live player/target entities, choose the first slot whose ability is
// a castable damage attack that is off cooldown, off GCD, affordable, and in
// range. No IO, no clock: cooldown and GCD remainders ride the player mirror.
// 'slots' mode never consults this; it keeps the config round-robin.
//
// Gold mode uses a separate mana-lean paladin kit (pickGoldCombatAbility +
// pickGoldMaintainBuff): Rite of Expulsion is only for pulls (brain stepGold),
// in combat it is auto-attack + Crusader Strike, Holy Ground only when more
// than one mob is on us, and long buffs are refreshed when they drop.

import type { ResolvedAbility } from '../src/sim/sim';
import { type Entity, MELEE_RANGE } from '../src/sim/types';
import { distance2 } from './navigator';

// Effect types that make an ability a damage attack worth casting on a
// hostile target. Heals, buffs, control, and utility stay out of the
// rotation; drainTick/judgement are the less obvious damage dealers included.
const DAMAGE_EFFECTS: ReadonlySet<string> = new Set([
  'directDamage',
  'weaponDamage',
  'weaponStrike',
  'chainDamage',
  'aoeDamage',
  'dot',
  'finisherDamage',
  'groundAoE',
  'drainTick',
  'judgement',
]);

export function isDamageAbility(ability: ResolvedAbility): boolean {
  return ability.effects.some((e) => DAMAGE_EFFECTS.has(e.type));
}

// Paladin self-heals for the out-of-combat heal rule (stepRest): Mending
// Light is preferred, Lightmend is the fallback when mana only covers that.
export const HOLY_LIGHT_ID = 'holy_light';
export const FLASH_OF_LIGHT_ID = 'flash_of_light';
export const HOLY_LIGHT_COST = 117;
export const FLASH_OF_LIGHT_COST = 46;

// Gold-mode paladin kit (ids match src/sim/content/classes.ts; names are the
// player-facing renames: Rite of Expulsion, Holy Ground, Oath of Iron, ...).
export const EXORCISM_ID = 'exorcism'; // Rite of Expulsion (pull only)
export const CRUSADER_STRIKE_ID = 'crusader_strike';
export const CONSECRATION_ID = 'consecration'; // Holy Ground
export const BLESSING_OF_MIGHT_ID = 'blessing_of_might'; // Oath of Iron
export const DEVOTION_AURA_ID = 'devotion_aura'; // Steadfast Aura
export const RETRIBUTION_AURA_ID = 'retribution_aura'; // Requital Aura

// Steadfast and Requital share exclusiveGroup 'paladin_aura': only one can
// stick. Gold prefers Requital (thorns for multi-pack trash); Steadfast is
// only applied when neither aura is up and Requital is unknown.
const PALADIN_AURA_IDS: readonly string[] = [RETRIBUTION_AURA_ID, DEVOTION_AURA_ID];

export type GoldCast =
  | { id: string; target: 'none' }
  | { id: string; target: 'self' }
  | { id: string; target: 'enemy' };

// The best self-heal the player can cast right now, or null (also null for
// every non-mana class and when both are on cooldown/GCD). known is the
// mirrored BotWorld.known list; the id must be present to count as known.
export function pickSelfHeal(
  known: readonly ResolvedAbility[],
  player: Entity,
): typeof HOLY_LIGHT_ID | typeof FLASH_OF_LIGHT_ID | null {
  if (player.resourceType !== 'mana' || player.gcdRemaining > 0) return null;
  const ready = (id: string, cost: number): boolean =>
    (player.cooldowns.get(id) ?? 0) <= 0 &&
    player.resource >= cost &&
    known.some((k) => k.def.id === id);
  if (ready(HOLY_LIGHT_ID, HOLY_LIGHT_COST)) return HOLY_LIGHT_ID;
  if (ready(FLASH_OF_LIGHT_ID, FLASH_OF_LIGHT_COST)) return FLASH_OF_LIGHT_ID;
  return null;
}

function findKnown(known: readonly ResolvedAbility[], id: string): ResolvedAbility | null {
  for (const a of known) {
    if (a.def.id === id) return a;
  }
  return null;
}

function hasAura(player: Entity, id: string): boolean {
  return player.auras.some((a) => a.id === id);
}

function hasAnyAura(player: Entity, ids: readonly string[]): boolean {
  return player.auras.some((a) => ids.includes(a.id));
}

// True when the ability is known, off CD, affordable, and either off-GCD or
// the GCD is free. Range is the caller's job (self-buffs ignore it).
function isCastable(known: readonly ResolvedAbility[], player: Entity, id: string): boolean {
  const ability = findKnown(known, id);
  if (!ability || ability.def.passive) return false;
  if ((player.cooldowns.get(id) ?? 0) > 0) return false;
  if (!ability.def.offGcd && player.gcdRemaining > 0) return false;
  if (!ability.freeCast && player.resource < ability.cost) return false;
  return true;
}

// Refresh Oath of Iron + one paladin aura when missing. Returns null when
// every maintained buff is already up or nothing is castable right now.
export function pickGoldMaintainBuff(
  known: readonly ResolvedAbility[],
  player: Entity,
): GoldCast | null {
  if (!hasAura(player, BLESSING_OF_MIGHT_ID) && isCastable(known, player, BLESSING_OF_MIGHT_ID)) {
    return { id: BLESSING_OF_MIGHT_ID, target: 'self' };
  }
  // Only one aura can stick (exclusiveGroup paladin_aura). Prefer Requital
  // for gold trash; fall back to Steadfast when Requital is not known.
  if (!hasAnyAura(player, PALADIN_AURA_IDS)) {
    if (isCastable(known, player, RETRIBUTION_AURA_ID)) {
      return { id: RETRIBUTION_AURA_ID, target: 'none' };
    }
    if (isCastable(known, player, DEVOTION_AURA_ID)) {
      return { id: DEVOTION_AURA_ID, target: 'none' };
    }
  }
  return null;
}

// Mana-lean gold combat cast, or null (caller keeps auto-attack only).
// attackerCount is how many living hostiles currently have aggro on us.
// Priority: Holy Ground when 2+ attackers, else Crusader Strike in melee.
// Rite of Expulsion is intentionally excluded (pull-only in stepGold).
export function pickGoldCombatAbility(
  known: readonly ResolvedAbility[],
  player: Entity,
  target: Entity,
  attackerCount: number,
): GoldCast | null {
  if (attackerCount >= 2 && isCastable(known, player, CONSECRATION_ID)) {
    return { id: CONSECRATION_ID, target: 'none' };
  }
  if (!isCastable(known, player, CRUSADER_STRIKE_ID)) return null;
  const ability = findKnown(known, CRUSADER_STRIKE_ID)!;
  const range = ability.def.range > 0 ? ability.def.range : MELEE_RANGE;
  const d2 = distance2(
    { x: player.pos.x, z: player.pos.z },
    { x: target.pos.x, z: target.pos.z },
  );
  if (d2 > range * range) return null;
  return { id: CRUSADER_STRIKE_ID, target: 'enemy' };
}

// The first castable damage ability in slot order, or null (the caller falls
// back to plain auto-attack). Range 0 on a def means melee range.
export function pickAbility(
  known: readonly ResolvedAbility[],
  player: Entity,
  target: Entity,
): { slot: number; id: string } | null {
  const d2 = distance2({ x: player.pos.x, z: player.pos.z }, { x: target.pos.x, z: target.pos.z });
  for (let slot = 0; slot < known.length; slot++) {
    const ability = known[slot];
    const def = ability.def;
    if (def.passive || !def.requiresTarget) continue;
    if (!isDamageAbility(ability)) continue;
    if ((player.cooldowns.get(def.id) ?? 0) > 0) continue;
    if (player.gcdRemaining > 0) continue;
    if (!ability.freeCast && player.resource < ability.cost) continue;
    const range = def.range > 0 ? def.range : MELEE_RANGE;
    if (d2 > range * range) continue;
    return { slot, id: def.id };
  }
  return null;
}
