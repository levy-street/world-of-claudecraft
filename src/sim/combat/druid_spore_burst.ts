// Spore Burst, the Moongrove and Groveheart ground mushroom (druid, level 10).
//
// The cast plants a spore burster at the aimed point. It grows for its fuse
// (5 sec from placement) and then bursts ONCE: every friendly unit inside the
// radius is healed and every hostile one takes Nature damage, with no target
// cap on either side. A Groveheart caster also plants Sporemending
// (`rejuvenation`) on each ally the burst heals.
//
// The mushroom is a GroundAoE rider (entity_roster.ts tickGroundAoEs), not an
// entity: it cannot be targeted or killed, and it replicates through the
// ground-telegraph wire like a Consecration, so every viewer sees the same
// timer. It fizzles if the caster dies or leaves before the burst, the rule
// every caster-owned persistent ground effect follows.
//
// A full engine bank empowers it: at full Verdance (Groveheart) or 3 Moontide
// (Moongrove) the cast is 25% stronger and spends the whole bank, like the
// spec's other payoffs (druid_engines.ts druidEngineOnCast); it still costs
// its mana. That stacks with an armed Nature's Boon window (free, +25%).
//
// Numbers are snapshotted when the cast resolves, the way groundAoE snapshots
// its Spell Power rider: the Healing Power and Spell Power riders, the talent
// and spec multipliers, the full-bank empowerment, and an armed Nature's Boon
// window's power. The burst itself only rolls.
//
// Determinism: the burst draws, in order, one heal roll per healed ally (plus
// applyHeal's crit roll), then one crit roll for the whole hostile side (only
// when something was struck, the canCrit aoeDamage rule), then one damage roll
// per struck enemy. Nothing draws while the mushroom grows.
import type { GroundAoE } from '../entity_roster';
import { scalePrimaryHealing } from '../primary_healing';
import type { SimContext } from '../sim_context';
import type { AbilityEffect, Entity, Vec3 } from '../types';
import {
  druidEngineOnHotPlanted,
  MOONTIDE_ID,
  MOONTIDE_STAGES,
  replantSporemending,
  VERDANCE_ID,
  VERDANCE_STAGES,
} from './druid_engines';
import { spellDamageMultFromAuras } from './spell_combat';

export const SPORE_BURST_ID = 'spore_burst';
/** The id Sporemending keeps on the wire and in saves (display name only). */
const SPOREMENDING_ID = 'rejuvenation';

/** A full Verdance or Moontide bank makes the cast this much stronger. */
export const SPORE_BURST_FULL_BANK_POWER = 1.25;

/** Is the druid's own Verdance or Moontide bank full? The one question the
 *  cast arm, the bank spend (druid_engines.ts) and the action bar's proc glow
 *  ask, so the glow can never promise a buff the cast will not pay. Structural,
 *  so the bar's mirrored auras fit; each bank only ever exists on its own spec. */
export function sporeBurstFullBank(
  auras: readonly { id?: string; stacks?: number; sourceId?: number }[],
  ownerId: number,
): boolean {
  return auras.some(
    (aura) =>
      aura.sourceId === ownerId &&
      ((aura.id === VERDANCE_ID && (aura.stacks ?? 0) >= VERDANCE_STAGES) ||
        (aura.id === MOONTIDE_ID && (aura.stacks ?? 0) >= MOONTIDE_STAGES)),
  );
}

/** The action bar's flashing proc glow on Spore Burst at a full bank. */
export function sporeBurstFullBankGlowActive(
  auras: readonly { id?: string; stacks?: number; sourceId?: number }[],
  ownerId: number,
  abilityId: string,
): boolean {
  return abilityId === SPORE_BURST_ID && sporeBurstFullBank(auras, ownerId);
}

export type SporeBurstEffect = Extract<AbilityEffect, { type: 'sporeBurst' }>;

/** The rider a planted spore burster carries on its GroundAoE. The damage
 *  roll rides the GroundAoE's own min/max and spBonus, like every zone. */
export interface SporeBurstGroundState {
  /** Stable per placement (caster id and placement tick), the wire id. */
  id: string;
  /** Seconds from placement to the burst; the readout's growth denominator. */
  fuse: number;
  healMin: number;
  healMax: number;
  /** Healing Power rider per healed ally, snapshotted at the cast. */
  healBonus: number;
  /** Whole-heal multiplier: the cast-scoped mark times Nature's Boon power. */
  healMult: number;
  /** The caster's primary-healing factor (spec tuning). */
  primaryHealMult: number;
  /** Whole-damage multiplier: Nature's Boon power times the spec's primary
   *  damage factor. */
  damageMult: number;
  /** Groveheart: plant Sporemending on every ally the burst heals. */
  plantsSporemending: boolean;
}

/** The cast arm (effect_dispatch.ts 'sporeBurst'): plant the mushroom. */
export function plantSporeBurst(
  ctx: SimContext,
  caster: Entity,
  aim: Vec3,
  effect: SporeBurstEffect,
  abilityName: string,
  snapshot: {
    spBonus: number;
    healBonus: number;
    healMult: number;
    primaryHealMult: number;
    damageMult: number;
    plantsSporemending: boolean;
    threat: { flat?: number; mult?: number };
  },
): void {
  const ground: GroundAoE = {
    sourceId: caster.id,
    pos: { ...aim },
    radius: effect.radius,
    min: effect.min,
    max: effect.max,
    remaining: effect.fuse,
    interval: effect.fuse,
    tickTimer: effect.fuse,
    school: 'nature',
    ability: abilityName,
    abilityId: SPORE_BURST_ID,
    spBonus: snapshot.spBonus,
    threat: snapshot.threat,
    sporeBurst: {
      id: `spore_burst:${caster.id}:${ctx.tickCount}`,
      fuse: effect.fuse,
      healMin: effect.healMin,
      healMax: effect.healMax,
      healBonus: snapshot.healBonus,
      healMult: snapshot.healMult,
      primaryHealMult: snapshot.primaryHealMult,
      damageMult: snapshot.damageMult,
      plantsSporemending: snapshot.plantsSporemending,
    },
  };
  ctx.groundAoEs.push(ground);
}

/** The burst, run once by tickGroundAoEs when the fuse runs out. */
export function burstSporeBurst(ctx: SimContext, ground: GroundAoE): void {
  const state = ground.sporeBurst;
  const source = ctx.entities.get(ground.sourceId);
  if (!state || !source || source.dead) return;
  ctx.emit({
    type: 'spellfxAt',
    x: ground.pos.x,
    z: ground.pos.z,
    school: 'nature',
    fx: 'sporeBurst',
    radius: ground.radius,
    ability: SPORE_BURST_ID,
    sourceId: source.id,
  });

  let plantedFresh = false;
  for (const ally of ctx.friendliesInRadius(source, ground.pos, ground.radius)) {
    if (ally.dead || !ctx.hasLineOfSight(source, ally)) continue;
    const rolled = ctx.rng.range(state.healMin, state.healMax) + state.healBonus;
    const whole = state.healMult === 1 ? rolled : Math.round(rolled * state.healMult);
    ctx.applyHeal(
      source,
      ally,
      scalePrimaryHealing(whole, state.primaryHealMult),
      ground.ability,
      SPORE_BURST_ID,
    );
    if (!state.plantsSporemending || ally.dead) continue;
    const fresh = !ally.auras.some(
      (aura) => aura.kind === 'hot' && aura.id === SPOREMENDING_ID && aura.sourceId === source.id,
    );
    replantSporemending(ctx, source, ally, state.healMult);
    if (fresh) plantedFresh = true;
  }
  // Verdance banks at most once per burst, however many allies it seeded: one
  // cast, one stage, the same as a single Sporemending cast.
  if (plantedFresh) druidEngineOnHotPlanted(ctx, source, SPOREMENDING_ID);

  const struck: Entity[] = [];
  for (const enemy of ctx.hostilesInRadius(source, ground.pos, ground.radius)) {
    if (ctx.hasLineOfSight(source, enemy)) struck.push(enemy);
  }
  if (struck.length === 0) return;
  const crit = ctx.rng.chance(ctx.spellCrit(source));
  const critMult = crit ? 1.5 + source.critDmgSpellBonus : 1;
  for (const enemy of struck) {
    const rolled = ctx.rng.range(ground.min, ground.max) + (ground.spBonus ?? 0);
    const amount = rolled * spellDamageMultFromAuras(source) * critMult * state.damageMult;
    ctx.dealDamage(
      source,
      enemy,
      Math.round(amount),
      crit,
      'nature',
      ground.ability,
      'hit',
      false,
      ground.threat,
      true,
      false,
      false,
      SPORE_BURST_ID,
      true,
    );
  }
}
