// Warspirit's deterministic weapon-posture and three-hit cadence engine.

import { MOBS } from '../data';
import type { SimContext } from '../sim_context';
import { TAUNT_FORCE_SECONDS, topThreatValue } from '../threat';
import type { Entity } from '../types';
import {
  galeheartEchoMultiplier,
  primalExaltationActive,
  SHAMAN_TALENT_IDS,
  shamanTalentSelected,
  stoneboundTalentDamageReduction,
} from './shaman_talents';

export const GALEHEART_WEAPON_ID = 'galeheart_weapon';
export const STONEBOUND_WEAPON_ID = 'rockbiter_weapon';
export const WARSPIRIT_CADENCE_ID = 'shaman_warspirit_cadence';
export const STORMCAST_ID = 'shaman_stormcast';
export const STORMCAST_CHEAP_ID = 'shaman_stormcast_cheap';
export const STORMSURGE_READY_ID = 'shaman_stormsurge_ready';
export const STORMSURGE_CHANCE = 0.25;
export const STORMSURGE_BAD_LUCK_CAP = 4;
export const STONEBOUND_ARMOR_ID = 'shaman_stonebound_armor';
export const STONEBOUND_DR_ID = 'shaman_stonebound_dr';
export const STONEBOUND_WARD_SMOOTH_ID = 'shaman_stonebound_ward_smooth';
export const WARSPIRIT_CADENCE_STEPS = 3;
export const GALEHEART_ECHO_COUNT = 2;
export const GALEHEART_ECHO_DAMAGE = 0.5;
export const STORMCAST_DURATION = 12;
// buff_armor_pct stores integer percentage points (30 = +30%).
export const STONEBOUND_ARMOR_BONUS = 30;
export const STONEBOUND_DAMAGE_REDUCTION = 0.1;
export const STONEBOUND_THREAT_MULTIPLIER = 2;
export const STONEBOUND_WARD_SMOOTH_REDUCTION = 0.1;
export const STONEBOUND_WARD_SMOOTH_DURATION = 3;
export const ELEMENTAL_TRANCE_ID = 'elemental_trance';
export const ELEMENTAL_TRANCE_MANA_PCT = 0.2;

const STORMSURGE_FAILURE_COUNTER = 'shaman_stormsurge_failures';

export const STORMCAST_ABILITIES: readonly string[] = [
  'lightning_bolt',
  'earth_shock',
  'flame_shock',
  'frost_shock',
  'healing_wave',
];

const WARSPIRIT_STATE_IDS: ReadonlySet<string> = new Set([
  GALEHEART_WEAPON_ID,
  STONEBOUND_WEAPON_ID,
  WARSPIRIT_CADENCE_ID,
  STORMCAST_ID,
  STORMCAST_CHEAP_ID,
  STORMSURGE_READY_ID,
  STONEBOUND_ARMOR_ID,
  STONEBOUND_DR_ID,
  STONEBOUND_WARD_SMOOTH_ID,
]);

function isWarspirit(ctx: SimContext, player: Entity): boolean {
  if (player.kind !== 'player') return false;
  const meta = ctx.players.get(player.id);
  return meta !== undefined && ctx.playerMods(meta).spec === 'enhancement';
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

function removeOwnedAuras(ctx: SimContext, player: Entity, ids: ReadonlySet<string>): void {
  for (let index = player.auras.length - 1; index >= 0; index--) {
    if (ids.has(player.auras[index].id)) removeAuraAt(ctx, player, index);
  }
}

function clearStoneboundForcedTargets(ctx: SimContext, playerId: number): void {
  for (const entity of ctx.entities.values()) {
    if (entity.forcedTargetId !== playerId) continue;
    entity.forcedTargetId = null;
    entity.forcedTargetTimer = 0;
  }
}

export function warspiritPosture(player: Entity): 'galeheart' | 'stonebound' | null {
  if (player.auras.some((aura) => aura.id === STONEBOUND_WEAPON_ID)) return 'stonebound';
  if (player.auras.some((aura) => aura.id === GALEHEART_WEAPON_ID)) return 'galeheart';
  return null;
}

export function applyWarspiritPosture(
  ctx: SimContext,
  player: Entity,
  posture: 'galeheart' | 'stonebound',
  imbueBonus = 0,
  duration = 1800,
): void {
  if (!isWarspirit(ctx, player)) return;
  const leavingStonebound = warspiritPosture(player) === 'stonebound' && posture !== 'stonebound';
  removeOwnedAuras(
    ctx,
    player,
    new Set([
      GALEHEART_WEAPON_ID,
      STONEBOUND_WEAPON_ID,
      STONEBOUND_ARMOR_ID,
      STONEBOUND_DR_ID,
      STONEBOUND_WARD_SMOOTH_ID,
    ]),
  );
  if (leavingStonebound) clearStoneboundForcedTargets(ctx, player.id);

  ctx.applyAura(player, {
    id: posture === 'galeheart' ? GALEHEART_WEAPON_ID : STONEBOUND_WEAPON_ID,
    name: posture === 'galeheart' ? 'Galeheart Weapon' : 'Stonebound Weapon',
    kind: 'imbue',
    value: posture === 'galeheart' ? 0 : imbueBonus,
    remaining: duration,
    duration,
    sourceId: player.id,
    school: 'nature',
  });
  if (posture !== 'stonebound') return;
  ctx.applyAura(player, {
    id: STONEBOUND_ARMOR_ID,
    name: 'Stonebound Armor',
    kind: 'buff_armor_pct',
    value: STONEBOUND_ARMOR_BONUS,
    remaining: duration,
    duration,
    sourceId: player.id,
    school: 'nature',
  });
  ctx.applyAura(player, {
    id: STONEBOUND_DR_ID,
    name: 'Stonebound Guard',
    kind: 'buff_dr',
    value: STONEBOUND_DAMAGE_REDUCTION + stoneboundTalentDamageReduction(ctx, player),
    remaining: duration,
    duration,
    sourceId: player.id,
    school: 'nature',
  });
}

export function warspiritCadence(player: Entity): number {
  const stacks = player.auras.find((aura) => aura.id === WARSPIRIT_CADENCE_ID)?.stacks ?? 0;
  return Math.max(0, Math.min(WARSPIRIT_CADENCE_STEPS - 1, stacks));
}

function setCadence(ctx: SimContext, player: Entity, steps: number): void {
  const existing = player.auras.find((aura) => aura.id === WARSPIRIT_CADENCE_ID);
  if (steps <= 0) {
    const index = player.auras.findIndex((aura) => aura.id === WARSPIRIT_CADENCE_ID);
    if (index >= 0) removeAuraAt(ctx, player, index);
    return;
  }
  if (existing) {
    existing.stacks = steps;
    existing.remaining = 86_400;
    return;
  }
  ctx.applyAura(player, {
    id: WARSPIRIT_CADENCE_ID,
    name: 'Warspirit Cadence',
    kind: 'internal_cd',
    value: 0,
    stacks: steps,
    remaining: 86_400,
    duration: 86_400,
    sourceId: player.id,
    school: 'nature',
  });
}

function armStormcast(ctx: SimContext, player: Entity): void {
  ctx.applyAura(player, {
    id: STORMCAST_ID,
    name: 'Stormcast',
    kind: 'next_cast_instant',
    value: 1,
    remaining: STORMCAST_DURATION,
    duration: STORMCAST_DURATION,
    sourceId: player.id,
    school: 'nature',
    empowerAbilities: [...STORMCAST_ABILITIES],
  });
  ctx.applyAura(player, {
    id: STORMCAST_CHEAP_ID,
    name: 'Stormcast',
    kind: 'next_cast_cheap',
    value: 0.5,
    remaining: STORMCAST_DURATION,
    duration: STORMCAST_DURATION,
    sourceId: player.id,
    school: 'nature',
    empowerAbilities: [...STORMCAST_ABILITIES],
  });
}

function setStormsurgeFailures(player: Entity, failures: number): void {
  if (failures <= 0) {
    if (player.procState) delete player.procState.counters[STORMSURGE_FAILURE_COUNTER];
    return;
  }
  if (!player.procState) player.procState = { counters: {}, icds: {} };
  player.procState.counters[STORMSURGE_FAILURE_COUNTER] = failures;
}

function tryProcStormsurge(ctx: SimContext, player: Entity): void {
  if ((player.cooldowns.get('stormstrike') ?? 0) <= 0) return;
  const failures = player.procState?.counters[STORMSURGE_FAILURE_COUNTER] ?? 0;
  if (ctx.rng.chance(STORMSURGE_CHANCE) || failures + 1 >= STORMSURGE_BAD_LUCK_CAP) {
    player.cooldowns.delete('stormstrike');
    setStormsurgeFailures(player, 0);
    ctx.applyAura(player, {
      id: STORMSURGE_READY_ID,
      name: 'Stormsurge',
      kind: 'internal_cd',
      value: 1,
      remaining: 6,
      duration: 6,
      sourceId: player.id,
      school: 'nature',
    });
    ctx.emit({
      type: 'spellfx',
      sourceId: player.id,
      targetId: player.id,
      school: 'nature',
      fx: 'procSurge',
    });
    return;
  }
  setStormsurgeFailures(player, failures + 1);
}

/**
 * Advances one shared cadence for either hand. `steps` is two for Ancestral
 * Strike and one for a landed base swing. Echoes copy resolved damage and draw
 * no RNG, so they cannot recursively advance the cadence.
 */
export function advanceWarspiritCadence(
  ctx: SimContext,
  player: Entity,
  target: Entity,
  resolvedWeaponDamage: number,
  steps: 1 | 2 = 1,
): boolean {
  if (!isWarspirit(ctx, player) || warspiritPosture(player) === null) return false;
  const cadenceTarget = primalExaltationActive(player) ? 2 : WARSPIRIT_CADENCE_STEPS;
  const total = warspiritCadence(player) + steps;
  if (total < cadenceTarget) {
    setCadence(ctx, player, total);
    return false;
  }
  setCadence(ctx, player, Math.min(cadenceTarget - 1, total - cadenceTarget));
  armStormcast(ctx, player);
  if (warspiritPosture(player) !== 'galeheart' || target.dead) return true;
  const echoDamage = Math.max(
    1,
    Math.round(resolvedWeaponDamage * GALEHEART_ECHO_DAMAGE * galeheartEchoMultiplier(ctx, player)),
  );
  for (let echo = 0; echo < GALEHEART_ECHO_COUNT && !target.dead; echo++) {
    ctx.dealDamage(player, target, echoDamage, false, 'nature', 'Galeheart Echo', 'hit', false);
  }
  if (shamanTalentSelected(ctx, player, SHAMAN_TALENT_IDS.livingWeapon)) {
    const nearby = ctx
      .hostilesInRadius(player, target.pos, 8)
      .filter((candidate) => candidate.id !== target.id && !candidate.dead)
      .sort((left, right) => {
        const leftDist = (left.pos.x - target.pos.x) ** 2 + (left.pos.z - target.pos.z) ** 2;
        const rightDist = (right.pos.x - target.pos.x) ** 2 + (right.pos.z - target.pos.z) ** 2;
        return leftDist - rightDist || left.id - right.id;
      })
      .slice(0, 2);
    for (const secondary of nearby) {
      ctx.dealDamage(
        player,
        secondary,
        Math.max(1, Math.round(echoDamage * 0.5)),
        false,
        'nature',
        'Living Weapon',
        'hit',
        false,
      );
    }
  }
  return true;
}

/** Runs when Stormcast's instant component is consumed by its spell. */
export function onStormcastConsumed(ctx: SimContext, player: Entity): void {
  if (!isWarspirit(ctx, player)) return;
  if (shamanTalentSelected(ctx, player, SHAMAN_TALENT_IDS.deepReservoir)) {
    setCadence(ctx, player, 1);
  }
  if (shamanTalentSelected(ctx, player, SHAMAN_TALENT_IDS.echoingElements)) {
    ctx.applyAura(player, {
      id: 'shaman_echoing_elements_stormcast',
      name: 'Echoing Elements',
      kind: 'power_echo',
      value: 0.4,
      remaining: STORMCAST_DURATION,
      duration: STORMCAST_DURATION,
      sourceId: player.id,
      school: 'nature',
    });
  }
  if (
    warspiritPosture(player) === 'stonebound' &&
    shamanTalentSelected(ctx, player, SHAMAN_TALENT_IDS.livingWeapon)
  ) {
    ctx.applyAura(player, {
      id: 'shaman_living_weapon_absorb',
      name: 'Living Weapon',
      kind: 'absorb',
      value: Math.max(1, Math.round(player.maxHp * 0.08)),
      remaining: 12,
      duration: 12,
      sourceId: player.id,
      school: 'nature',
    });
  }
  tryProcStormsurge(ctx, player);
}

export function stoneboundThreatMultiplier(ctx: SimContext, player: Entity): number {
  return isWarspirit(ctx, player) && warspiritPosture(player) === 'stonebound'
    ? STONEBOUND_THREAT_MULTIPLIER
    : 1;
}

export function applyStoneboundJolt(ctx: SimContext, player: Entity, target: Entity): void {
  if (!isWarspirit(ctx, player) || warspiritPosture(player) !== 'stonebound' || target.dead) return;
  target.threat.set(
    player.id,
    Math.max(target.threat.get(player.id) ?? 0, topThreatValue(target), 1),
  );
  const template = MOBS[target.templateId];
  if (template?.ignoreTaunt || template?.dummy || (player.ownerId !== null && template?.boss)) {
    return;
  }
  target.forcedTargetId = player.id;
  target.forcedTargetTimer = TAUNT_FORCE_SECONDS;
}

export function applyStoneboundWardSmoothing(
  ctx: SimContext,
  player: Entity,
  abilityId: string,
): void {
  if (
    abilityId !== 'lightning_shield' ||
    !isWarspirit(ctx, player) ||
    warspiritPosture(player) !== 'stonebound'
  ) {
    return;
  }
  ctx.applyAura(player, {
    id: STONEBOUND_WARD_SMOOTH_ID,
    name: 'Stonebound Ward',
    kind: 'buff_dr',
    value: STONEBOUND_WARD_SMOOTH_REDUCTION,
    remaining: STONEBOUND_WARD_SMOOTH_DURATION,
    duration: STONEBOUND_WARD_SMOOTH_DURATION,
    sourceId: player.id,
    school: 'nature',
  });
}

/**
 * Elemental Trance's mana return: while the trance buff is worn, a fifth of
 * ALL damage the shaman deals comes back as mana. Runs on the landed amount in
 * dealDamage's dealt-side block (beside rage-from-dealing), draws no rng and
 * emits nothing, so the shared draw order and event stream are untouched.
 */
export function elementalTranceManaFromDamage(
  ctx: SimContext,
  source: Entity,
  amount: number,
): void {
  if (amount <= 0 || source.resourceType !== 'mana') return;
  if (!source.auras.some((aura) => aura.id === ELEMENTAL_TRANCE_ID)) return;
  const gain = Math.max(1, Math.round(amount * ELEMENTAL_TRANCE_MANA_PCT));
  source.resource = Math.min(source.maxResource, source.resource + gain);
}

export function clearWarspiritState(ctx: SimContext, player: Entity): void {
  removeOwnedAuras(ctx, player, WARSPIRIT_STATE_IDS);
  setStormsurgeFailures(player, 0);
  clearStoneboundForcedTargets(ctx, player.id);
}
