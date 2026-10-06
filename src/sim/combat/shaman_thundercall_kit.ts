// Thundercall v0.44 rework kit: the classic elemental procs layered on the
// build-and-vent Thunder engine (combat/shaman_thundercall.ts).
//
// - Arc Overload: the TBC Lightning Overload talent at 5/5 (20% chance, the
//   repeat strikes for half). Its repeat also banks one Thunder, so the bank
//   fills at a variable pace instead of a fixed five-bolt count.
// - Magma Burst: the Wrath Lava Burst rule, a guaranteed crit against a
//   target carrying the caster's own Cinder Jolt DoT.
// - Magma Surge: the Cataclysm Lava Surge proc (20% per Cinder Jolt tick)
//   resets Magma Burst and makes the next one instant.
// - Stormbreak: the Wrath Thunderstorm's 8% maximum Mana return.
//
// v0.45 rotation fix: Magma Burst banks Thunder, and Cinder Jolt runs the
// Cataclysm-era 18 sec, so the Cinder Jolt and Magma Burst loop feeds the
// Earthen Jolt vent instead of starving it.
//
// Every rng draw here is gated on a Thundercall caster who KNOWS the relevant
// ability, so no other build's draw stream moves. Design and numbers:
// docs/prd/shaman-thundercall-elemental-v028.md ("v0.44.0 rework" and
// "v0.45.0 rotation fix").

import { STORMKINDLED_2PC_ARC_OVERLOAD_CHANCE } from '../content/ignivar_set_bonuses';
import type { PlayerMeta, ResolvedAbility } from '../sim';
import type { SimContext } from '../sim_context';
import type { Aura, Entity } from '../types';
import { wearsSetBonus } from './set_bonus_wearer';
import { addThunderCharges, MAGMA_SURGE_ID } from './shaman_thundercall';

export const ARC_OVERLOAD_ABILITY_ID = 'lightning_overload';
export const ARC_OVERLOAD_CHANCE = 0.2;
export const ARC_OVERLOAD_DAMAGE_FRACTION = 0.5;
export const ARC_OVERLOAD_THUNDER = 1;
export const MAGMA_BURST_ABILITY_ID = 'lava_burst';
export const MAGMA_BURST_THUNDER = 1;
export const MAGMA_SURGE_CHANCE = 0.2;
export const MAGMA_SURGE_DURATION = 10;
export const STORMBREAK_ABILITY_ID = 'thunderstorm';
export const STORMBREAK_MANA_FRACTION = 0.08;
// The Cataclysm Flame Shock duration. Cinder Jolt shares the shock cooldown
// with Earthen Jolt, so a longer DoT claims that cooldown less often.
export const THUNDERCALL_CINDER_JOLT_DURATION = 18;

const CINDER_JOLT_DOT_ID = 'flame_shock';
const OVERLOAD_ABILITIES: ReadonlySet<string> = new Set(['lightning_bolt', 'chain_lightning']);

function thundercallMeta(ctx: SimContext, player: Entity | null) {
  if (!player || player.kind !== 'player') return null;
  const meta = ctx.players.get(player.id);
  if (!meta || ctx.playerMods(meta).spec !== 'elemental') return null;
  return meta;
}

function knows(ctx: SimContext, player: Entity, abilityId: string): boolean {
  const meta = thundercallMeta(ctx, player);
  return meta !== null && meta.known.some((known) => known.def.id === abilityId);
}

/**
 * Rolls Arc Overload after an Arc Bolt or Skybranch hit. `plannedDamage` is
 * the amount the primary hit handed to dealDamage (crit included, before the
 * caster's output modifiers such as damage-done buffs or Weakening Hex), so
 * the repeat takes half of it and dealDamage applies those modifiers once,
 * exactly as it did for the parent: the result is half the parent's damage.
 * `landed` is what the parent actually took off the target; a hit that did
 * nothing (evade, immunity) never rolls. The only draw is the proc chance.
 */
export function rollArcOverload(
  ctx: SimContext,
  player: Entity,
  target: Entity,
  abilityId: string,
  plannedDamage: number,
  landed: number,
  threatMult?: number,
): boolean {
  if (!OVERLOAD_ABILITIES.has(abilityId) || plannedDamage <= 0 || landed <= 0) return false;
  if (target.dead) return false;
  if (!knows(ctx, player, ARC_OVERLOAD_ABILITY_ID)) return false;
  // Stormkindled 2pc raises the threshold; the one draw is identical either way.
  const chance = wearsSetBonus(ctx, player, 'stormkindled', 2)
    ? STORMKINDLED_2PC_ARC_OVERLOAD_CHANCE
    : ARC_OVERLOAD_CHANCE;
  if (!ctx.rng.chance(chance)) return false;
  ctx.emit({
    type: 'spellfx',
    sourceId: player.id,
    targetId: target.id,
    school: 'nature',
    fx: 'projectile',
    ability: 'lightning_bolt',
  });
  ctx.dealDamage(
    player,
    target,
    Math.max(1, Math.round(plannedDamage * ARC_OVERLOAD_DAMAGE_FRACTION)),
    false,
    'nature',
    'Arc Overload',
    'hit',
    false,
    // Multiplier only: a flat threat add belongs to the parent cast, once.
    threatMult === undefined ? undefined : { mult: threatMult },
    true,
    false,
    // Not final: the caster's output modifiers apply to the copy once.
    false,
    ARC_OVERLOAD_ABILITY_ID,
  );
  addThunderCharges(ctx, player, ARC_OVERLOAD_THUNDER);
  return true;
}

/** Called only after Magma Burst has resolved a valid direct-damage impact,
 *  the same point Arc Bolt banks its Thunder. Draws no rng. */
export function thundercallOnMagmaBurstImpact(ctx: SimContext, player: Entity): void {
  addThunderCharges(ctx, player, MAGMA_BURST_THUNDER);
}

/** Thundercall's Cinder Jolt DoT runs THUNDERCALL_CINDER_JOLT_DURATION at the
 *  same damage per tick, so the total grows with the tick count. The total is
 *  built from the rounded tick effect_dispatch.ts deals, so the tooltip total is
 *  exactly what lands. Every other spec and ability passes through untouched.
 *  Shared by the sim and every display caller (combat/ability_resolution.ts). */
export function resolveThundercallAbility(
  resolved: ResolvedAbility,
  meta: Pick<PlayerMeta, 'cls' | 'talents'>,
): ResolvedAbility {
  if (meta.cls !== 'shaman' || meta.talents.spec !== 'elemental') return resolved;
  if (resolved.def.id !== CINDER_JOLT_DOT_ID) return resolved;
  return {
    ...resolved,
    effects: resolved.effects.map((effect) => {
      if (effect.type !== 'dot') return effect;
      const perTick = Math.round(effect.total / (effect.duration / effect.interval));
      return {
        ...effect,
        total: perTick * (THUNDERCALL_CINDER_JOLT_DURATION / effect.interval),
        duration: THUNDERCALL_CINDER_JOLT_DURATION,
      };
    }),
  };
}

/** Magma Burst always crits a target burning with the caster's own Cinder Jolt. */
export function magmaBurstGuaranteedCrit(
  ctx: SimContext,
  player: Entity,
  abilityId: string,
  target: Entity,
): boolean {
  if (abilityId !== MAGMA_BURST_ABILITY_ID || thundercallMeta(ctx, player) === null) return false;
  return target.auras.some(
    (aura) => aura.id === CINDER_JOLT_DOT_ID && aura.kind === 'dot' && aura.sourceId === player.id,
  );
}

/**
 * Called once per DoT tick with the damage it landed; only a Thundercall's own
 * Cinder Jolt tick that dealt damage can surge. No roll while the caster is
 * hard-casting Magma Burst: that cast arms the cooldown when it completes,
 * which would strand a proc taken mid-cast.
 */
export function thundercallOnDotTick(
  ctx: SimContext,
  source: Entity | null,
  dot: Aura,
  landed: number,
): void {
  if (dot.id !== CINDER_JOLT_DOT_ID || !source || source.dead || landed <= 0) return;
  if (source.castingAbility === MAGMA_BURST_ABILITY_ID) return;
  if (!knows(ctx, source, MAGMA_BURST_ABILITY_ID)) return;
  if (!ctx.rng.chance(MAGMA_SURGE_CHANCE)) return;
  source.cooldowns.delete(MAGMA_BURST_ABILITY_ID);
  ctx.applyAura(source, {
    id: MAGMA_SURGE_ID,
    name: 'Magma Burst',
    kind: 'next_cast_instant',
    value: 1,
    remaining: MAGMA_SURGE_DURATION,
    duration: MAGMA_SURGE_DURATION,
    sourceId: source.id,
    school: 'fire',
    empowerAbilities: [MAGMA_BURST_ABILITY_ID],
  });
  ctx.emit({
    type: 'spellfx',
    sourceId: source.id,
    targetId: source.id,
    school: 'fire',
    fx: 'procSurge',
  });
}

/** Stormbreak's Mana return, applied once per successful cast. */
export function applyStormbreakMana(ctx: SimContext, player: Entity): void {
  if (thundercallMeta(ctx, player) === null || player.resourceType !== 'mana') return;
  player.resource = Math.min(
    player.maxResource,
    player.resource + Math.round(player.maxResource * STORMBREAK_MANA_FRACTION),
  );
}
