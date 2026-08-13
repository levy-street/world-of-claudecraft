// Thundercall's deterministic build-and-vent engine. The bank rides an aura so
// offline, hosted, reconnect, and replay state all use the same authority.

import type { SimContext } from '../sim_context';
import type { Entity } from '../types';
import {
  primalExaltationActive,
  pyrebrandBonusCharge,
  SHAMAN_TALENT_IDS,
  shamanTalentSelected,
} from './shaman_talents';

export const THUNDER_CHARGES_ID = 'shaman_thunder_charges';
export const PRIMAL_MASTERY_ID = 'elemental_mastery';
export const PRIMAL_MASTERY_INSTANT_ID = 'elemental_mastery_instant';
export const PRIMAL_MASTERY_VENT_ID = 'elemental_mastery_vent';
export const THUNDER_CHARGE_CAP = 5;
export const THUNDER_BANK_DURATION = 86_400;
export const EARTHEN_JOLT_BONUS_PER_CHARGE = 0.25;
// Starting PBE value. Faultwake's coefficient remains independently tunable.
export const FAULTWAKE_BONUS_PER_CHARGE = 0.2;
export const PRIMAL_MASTERY_DURATION = 12;
export const PRIMAL_MASTERY_VENT_BONUS = 0.25;

const THUNDER_VENTS: ReadonlySet<string> = new Set(['earth_shock', 'earthquake']);
const THUNDERCALL_STATE_IDS: ReadonlySet<string> = new Set([
  'flametongue_weapon',
  THUNDER_CHARGES_ID,
  PRIMAL_MASTERY_ID,
  PRIMAL_MASTERY_INSTANT_ID,
  PRIMAL_MASTERY_VENT_ID,
]);

function isThundercall(ctx: SimContext, player: Entity): boolean {
  if (player.kind !== 'player') return false;
  const meta = ctx.players.get(player.id);
  return meta !== undefined && ctx.playerMods(meta).spec === 'elemental';
}

function removeAuraAt(ctx: SimContext, player: Entity, index: number): void {
  const [aura] = player.auras.splice(index, 1);
  if (!aura) return;
  ctx.emit({
    type: 'aura',
    targetId: player.id,
    name: aura.name,
    gained: false,
    auraKind: aura.kind,
  });
}

export function thunderCharges(player: Entity): number {
  const stacks = player.auras.find((aura) => aura.id === THUNDER_CHARGES_ID)?.stacks ?? 0;
  return Math.max(0, Math.min(THUNDER_CHARGE_CAP, stacks));
}

/** Pure action-bar predicate for the persistent full-bank payoff cue. */
export function thundercallPayoffGlowActive(
  auras: readonly { id?: string; stacks?: number }[],
  abilityId: string,
): boolean {
  if (!THUNDER_VENTS.has(abilityId)) return false;
  return auras.some(
    (aura) => aura.id === THUNDER_CHARGES_ID && (aura.stacks ?? 0) >= THUNDER_CHARGE_CAP,
  );
}

export function addThunderCharges(ctx: SimContext, player: Entity, requested: number): number {
  if (!isThundercall(ctx, player) || requested <= 0) return thunderCharges(player);
  const existing = player.auras.find((aura) => aura.id === THUNDER_CHARGES_ID);
  const next = Math.min(THUNDER_CHARGE_CAP, thunderCharges(player) + Math.floor(requested));
  if (existing) {
    existing.stacks = next;
    existing.remaining = THUNDER_BANK_DURATION;
    existing.duration = THUNDER_BANK_DURATION;
    return next;
  }
  ctx.applyAura(player, {
    id: THUNDER_CHARGES_ID,
    name: 'Thunder Charges',
    kind: 'internal_cd',
    value: 0,
    stacks: next,
    remaining: THUNDER_BANK_DURATION,
    duration: THUNDER_BANK_DURATION,
    sourceId: player.id,
    school: 'nature',
  });
  return next;
}

/** Called only after Arc Bolt has resolved a valid direct-damage impact. */
export function thundercallOnArcBoltImpact(ctx: SimContext, player: Entity): void {
  if (!isThundercall(ctx, player)) return;
  const accelerated =
    player.auras.some((aura) => aura.id === PRIMAL_MASTERY_ID) || primalExaltationActive(player);
  addThunderCharges(ctx, player, (accelerated ? 2 : 1) + pyrebrandBonusCharge(ctx, player));
}

/** Skybranch grants one Thunder for the whole landed chain, never one per bounce. */
export function thundercallOnChainLightningImpact(ctx: SimContext, player: Entity): void {
  if (!isThundercall(ctx, player)) return;
  addThunderCharges(ctx, player, 1);
}

export function thundercallDamageMultiplier(
  ctx: SimContext,
  player: Entity,
  abilityId: string,
): number {
  if (!isThundercall(ctx, player)) return 1;
  const charges = thunderCharges(player);
  if (charges < THUNDER_CHARGE_CAP) return 1;
  const primalBonus = player.auras.some((aura) => aura.id === PRIMAL_MASTERY_VENT_ID)
    ? PRIMAL_MASTERY_VENT_BONUS
    : 0;
  if (abilityId === 'earth_shock') {
    return (1 + charges * EARTHEN_JOLT_BONUS_PER_CHARGE) * (1 + primalBonus);
  }
  if (abilityId === 'earthquake') {
    return (1 + charges * FAULTWAKE_BONUS_PER_CHARGE) * (1 + primalBonus);
  }
  return 1;
}

/** Snapshot whether Faultwake should schedule its nonrecursive 40% ground echo. */
export function shouldEchoThunderGroundVent(
  ctx: SimContext,
  player: Entity,
  abilityId: string,
): boolean {
  return (
    abilityId === 'earthquake' &&
    isThundercall(ctx, player) &&
    thunderCharges(player) === THUNDER_CHARGE_CAP &&
    shamanTalentSelected(ctx, player, SHAMAN_TALENT_IDS.echoingElements)
  );
}

/** Consume after a vent has resolved successfully, never at input time. */
export function consumeThunderVent(
  ctx: SimContext,
  player: Entity,
  abilityId: string,
  target?: Entity | null,
  resolvedDamage = 0,
): number {
  if (!isThundercall(ctx, player) || !THUNDER_VENTS.has(abilityId)) return 0;
  const charges = thunderCharges(player);
  if (charges < THUNDER_CHARGE_CAP) return 0;
  const index = player.auras.findIndex((aura) => aura.id === THUNDER_CHARGES_ID);
  if (index >= 0) removeAuraAt(ctx, player, index);
  const primalVentIndex = player.auras.findIndex((aura) => aura.id === PRIMAL_MASTERY_VENT_ID);
  if (primalVentIndex >= 0) {
    removeAuraAt(ctx, player, primalVentIndex);
    ctx.emit({
      type: 'spellfx',
      sourceId: player.id,
      targetId: target?.id ?? player.id,
      school: 'nature',
      fx: 'procSurge',
    });
  }
  if (charges === THUNDER_CHARGE_CAP) {
    if (shamanTalentSelected(ctx, player, SHAMAN_TALENT_IDS.deepReservoir)) {
      addThunderCharges(ctx, player, 2);
    }
    if (
      shamanTalentSelected(ctx, player, SHAMAN_TALENT_IDS.livingWeapon) &&
      player.auras.some((aura) => aura.id === 'flametongue_weapon')
    ) {
      ctx.applyAura(player, {
        id: 'shaman_living_weapon_bolt',
        name: 'Living Weapon',
        kind: 'next_cast_instant',
        value: 1,
        remaining: 12,
        duration: 12,
        sourceId: player.id,
        school: 'fire',
        empowerAbilities: ['lightning_bolt'],
      });
    }
    if (
      target &&
      !target.dead &&
      resolvedDamage > 0 &&
      shamanTalentSelected(ctx, player, SHAMAN_TALENT_IDS.echoingElements)
    ) {
      ctx.applyAura(target, {
        id: 'shaman_echoing_elements_damage',
        name: 'Echoing Elements',
        kind: 'dot',
        value: Math.max(1, Math.round(resolvedDamage * 0.4)),
        remaining: 1,
        duration: 1,
        tickInterval: 1,
        tickTimer: 1,
        sourceId: player.id,
        school: 'nature',
      });
    }
  }
  return charges;
}

/** Arms the signature window and scopes its instant cast to a Thundercall lightning builder. */
export function armPrimalMastery(ctx: SimContext, player: Entity): void {
  if (!isThundercall(ctx, player)) return;
  ctx.applyAura(player, {
    id: PRIMAL_MASTERY_ID,
    name: 'Primal Mastery',
    kind: 'internal_cd',
    value: 0,
    remaining: PRIMAL_MASTERY_DURATION,
    duration: PRIMAL_MASTERY_DURATION,
    sourceId: player.id,
    school: 'nature',
  });
  ctx.applyAura(player, {
    id: PRIMAL_MASTERY_INSTANT_ID,
    name: 'Primal Mastery',
    kind: 'next_cast_instant',
    value: 1,
    remaining: PRIMAL_MASTERY_DURATION,
    duration: PRIMAL_MASTERY_DURATION,
    sourceId: player.id,
    school: 'nature',
    empowerAbilities: ['lightning_bolt', 'chain_lightning'],
  });
  ctx.applyAura(player, {
    id: PRIMAL_MASTERY_VENT_ID,
    name: 'Primal Mastery',
    kind: 'internal_cd',
    value: PRIMAL_MASTERY_VENT_BONUS,
    remaining: PRIMAL_MASTERY_DURATION,
    duration: PRIMAL_MASTERY_DURATION,
    sourceId: player.id,
    school: 'nature',
  });
}

export function clearThundercallState(ctx: SimContext, player: Entity): void {
  for (let index = player.auras.length - 1; index >= 0; index--) {
    if (THUNDERCALL_STATE_IDS.has(player.auras[index].id)) removeAuraAt(ctx, player, index);
  }
}
