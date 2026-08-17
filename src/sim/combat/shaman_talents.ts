// Shaman Talents 2.0 runtime helpers. Talent identity is read from the flat
// precomputed modifier map; transient counters and windows ride auras so the
// offline sim, server sim, snapshots, and parity traces share one state model.

import type { SimContext } from '../sim_context';
import { type Aura, CAST_COMPLETE_EPS, DT, type Entity } from '../types';

export const SHAMAN_TALENT_IDS = {
  wolfstep: 'sha_r5_concussion',
  gatheringWinds: 'sha_r5_improved_lightning_shield',
  flowingElements: 'sha_r5_imbue_mastery',
  stoneward: 'sha_r8_improved_earth_shock',
  wardedElements: 'sha_r8_frost_bind',
  ancestralMending: 'sha_r8_shock_efficiency',
  faultRebuke: 'sha_r11_ancestral_guidance',
  rimeLock: 'sha_r11_elemental_attunement',
  grippingEarth: 'sha_r11_healing_stream',
  flowState: 'sha_r14_chain_lightning',
  imbueMastery: 'sha_r14_improved_flame_shock',
  wardCycle: 'sha_r14_weapon_fury',
  primalExaltation: 'sha_r17_earthbind',
  wayfarerGrace: 'sha_r17_improved_ghost_wolf',
  ancestralBulwark: 'sha_r17_elemental_warding',
  deepReservoir: 'sha_r20_bloodlust',
  echoingElements: 'sha_r20_elemental_fury',
  livingWeapon: 'sha_r20_tidal_waves',
} as const;

export type ShamanTalentId = (typeof SHAMAN_TALENT_IDS)[keyof typeof SHAMAN_TALENT_IDS];

export const STONEWARD_ID = 'shaman_stoneward';
export const PRIMAL_EXALTATION_ID = 'shaman_primal_exaltation';
export const FLOWING_ELEMENTS_ID = 'shaman_flowing_elements';
export const WAYFARER_GRACE_ID = 'shaman_wayfarer_grace';
export const FLOW_STATE_PROGRESS_ID = 'shaman_flow_state_progress';
export const FLOW_STATE_READY_ID = 'shaman_flow_state_ready';
export const WARD_CYCLE_ICD_ID = 'shaman_ward_cycle_icd';
export const GATHERING_WINDS_ICD_ID = 'shaman_gathering_winds_icd';
export const WAYFARER_GRACE_ICD_ID = 'shaman_wayfarer_grace_icd';
export const ANCESTRAL_BULWARK_ICD_ID = 'shaman_ancestral_bulwark_icd';
export const FLOW_STATE_COST_REDUCTION = 40;

const LONG_STATE_DURATION = 86_400;
const JOLT_IDS: ReadonlySet<string> = new Set(['earth_shock', 'flame_shock', 'frost_shock']);
const FLOWING_ABILITIES: readonly string[] = ['lightning_bolt', 'healing_wave'];

function shamanMeta(ctx: SimContext, player: Entity) {
  if (player.kind !== 'player') return null;
  const meta = ctx.players.get(player.id);
  return meta?.cls === 'shaman' ? meta : null;
}

export function shamanTalentSelected(
  ctx: SimContext,
  player: Entity,
  talentId: ShamanTalentId,
): boolean {
  const meta = shamanMeta(ctx, player);
  return meta !== null && ctx.playerMods(meta).selected[talentId] === true;
}

function removeAuraAt(ctx: SimContext, target: Entity, index: number): Aura | null {
  const [aura] = target.auras.splice(index, 1);
  if (!aura) return null;
  ctx.emit({
    type: 'aura',
    targetId: target.id,
    name: aura.name,
    gained: false,
    auraKind: aura.kind,
  });
  return aura;
}

function applyInternalState(
  ctx: SimContext,
  player: Entity,
  id: string,
  name: string,
  duration: number,
  value = 0,
): Aura {
  ctx.applyAura(player, {
    id,
    name,
    kind: 'internal_cd',
    value,
    remaining: duration,
    duration,
    sourceId: player.id,
    school: 'nature',
  });
  const applied = player.auras.find((aura) => aura.id === id && aura.sourceId === player.id);
  if (!applied) throw new Error(`failed to apply Shaman talent state ${id}`);
  return applied;
}

export function applyStoneward(ctx: SimContext, source: Entity, target: Entity): void {
  if (!shamanTalentSelected(ctx, source, SHAMAN_TALENT_IDS.stoneward) || target.dead) return;
  for (const entity of ctx.entities.values()) {
    for (let index = entity.auras.length - 1; index >= 0; index--) {
      const aura = entity.auras[index];
      if (aura.id === STONEWARD_ID && aura.sourceId === source.id) removeAuraAt(ctx, entity, index);
    }
  }
  ctx.applyAura(target, {
    id: STONEWARD_ID,
    name: 'Stoneward',
    kind: 'internal_cd',
    value: 0,
    charges: 6,
    icd: 0,
    icdMax: 3,
    remaining: 60,
    duration: 60,
    sourceId: source.id,
    school: 'nature',
  });
}

export function onShamanDamageTaken(ctx: SimContext, target: Entity, amount: number): void {
  if (amount <= 0 || target.dead) return;
  for (let index = target.auras.length - 1; index >= 0; index--) {
    const ward = target.auras[index];
    if (
      ward.id !== STONEWARD_ID ||
      (ward.charges ?? 0) <= 0 ||
      (ward.icd ?? 0) > CAST_COMPLETE_EPS
    ) {
      continue;
    }
    const source = ctx.entities.get(ward.sourceId);
    if (!source || source.dead) {
      removeAuraAt(ctx, target, index);
      continue;
    }
    ward.charges = Math.max(0, (ward.charges ?? 0) - 1);
    ward.icd = ward.icdMax ?? 3;
    ctx.applyHeal(
      source,
      target,
      Math.round(target.maxHp * 0.05),
      'Stoneward',
      STONEWARD_ID,
      false,
      false,
    );
    if ((ward.charges ?? 0) <= 0) removeAuraAt(ctx, target, index);
  }
}

export function tickShamanTalentAura(aura: Aura): void {
  if (aura.id === STONEWARD_ID && (aura.icd ?? 0) > 0) {
    aura.icd = Math.max(0, (aura.icd ?? 0) - DT);
  }
}

export function applyPrimalExaltation(ctx: SimContext, player: Entity): void {
  if (!shamanTalentSelected(ctx, player, SHAMAN_TALENT_IDS.primalExaltation)) return;
  applyInternalState(ctx, player, PRIMAL_EXALTATION_ID, 'Primal Exaltation', 12);
}

export function primalExaltationActive(player: Entity): boolean {
  return player.auras.some((aura) => aura.id === PRIMAL_EXALTATION_ID);
}

export function shamanCastTimeMultiplier(player: Entity, abilityId: string): number {
  return (abilityId === 'lightning_bolt' || abilityId === 'chain_lightning') &&
    primalExaltationActive(player)
    ? 0.5
    : 1;
}

export function shamanManaCost(ctx: SimContext, player: Entity, cost: number): number {
  if (
    cost <= 0 ||
    player.resourceType !== 'mana' ||
    !shamanTalentSelected(ctx, player, SHAMAN_TALENT_IDS.flowState) ||
    !player.auras.some((aura) => aura.id === FLOW_STATE_READY_ID)
  ) {
    return cost;
  }
  return Math.max(0, cost - FLOW_STATE_COST_REDUCTION);
}

export function flowStateDiscountedCost(auras: readonly { id?: string }[], cost: number): number {
  return cost > 0 && auras.some((aura) => aura.id === FLOW_STATE_READY_ID)
    ? Math.max(0, cost - FLOW_STATE_COST_REDUCTION)
    : cost;
}

export function onShamanManaSpent(
  ctx: SimContext,
  player: Entity,
  amount: number,
  eligibleAction = amount > 0,
): void {
  if (
    !eligibleAction ||
    player.resourceType !== 'mana' ||
    !shamanTalentSelected(ctx, player, SHAMAN_TALENT_IDS.flowState)
  ) {
    return;
  }
  const readyIndex = player.auras.findIndex((aura) => aura.id === FLOW_STATE_READY_ID);
  if (readyIndex >= 0) removeAuraAt(ctx, player, readyIndex);
  if (amount <= 0) return;
  const progress = player.auras.find((aura) => aura.id === FLOW_STATE_PROGRESS_ID);
  const total = (progress?.value ?? 0) + amount;
  const remainder = total >= 120 ? total - 120 : total;
  if (progress) {
    progress.value = remainder;
    progress.remaining = LONG_STATE_DURATION;
  } else if (remainder > 0) {
    applyInternalState(
      ctx,
      player,
      FLOW_STATE_PROGRESS_ID,
      'Flow State',
      LONG_STATE_DURATION,
      remainder,
    );
  }
  if (total >= 120) {
    applyInternalState(ctx, player, FLOW_STATE_READY_ID, 'Flow State', LONG_STATE_DURATION);
  }
}

export function imbueMasteryActive(ctx: SimContext, player: Entity): boolean {
  return shamanTalentSelected(ctx, player, SHAMAN_TALENT_IDS.imbueMastery);
}

export function pyrebrandBonusCharge(ctx: SimContext, player: Entity): number {
  if (
    !imbueMasteryActive(ctx, player) ||
    !player.auras.some((aura) => aura.id === 'flametongue_weapon')
  ) {
    return 0;
  }
  const counter = player.auras.find((aura) => aura.id === 'shaman_pyrebrand_mastery');
  const next = (counter?.stacks ?? 0) + 1;
  if (next >= 3) {
    if (counter) {
      counter.stacks = 0;
      counter.remaining = LONG_STATE_DURATION;
    } else {
      const aura = applyInternalState(
        ctx,
        player,
        'shaman_pyrebrand_mastery',
        'Imbue Mastery',
        LONG_STATE_DURATION,
      );
      aura.stacks = 0;
    }
    return 1;
  }
  if (counter) {
    counter.stacks = next;
    counter.remaining = LONG_STATE_DURATION;
  } else {
    const aura = applyInternalState(
      ctx,
      player,
      'shaman_pyrebrand_mastery',
      'Imbue Mastery',
      LONG_STATE_DURATION,
    );
    aura.stacks = next;
  }
  return 0;
}

export function galeheartEchoMultiplier(ctx: SimContext, player: Entity): number {
  return imbueMasteryActive(ctx, player) ? 1.25 : 1;
}

export function stoneboundTalentDamageReduction(ctx: SimContext, player: Entity): number {
  return imbueMasteryActive(ctx, player) ? 0.05 : 0;
}

export function spiritmendTalentDepositMultiplier(_ctx: SimContext, player: Entity): number {
  return primalExaltationActive(player) ? 1.5 : 1;
}

export function lifespringMasteryDepositBonus(ctx: SimContext, player: Entity): number {
  return imbueMasteryActive(ctx, player) &&
    player.auras.some((aura) => aura.id === 'lifespring_weapon')
    ? 0.2
    : 0;
}

export function triggerWardCycle(ctx: SimContext, player: Entity): void {
  if (
    !shamanTalentSelected(ctx, player, SHAMAN_TALENT_IDS.wardCycle) ||
    player.auras.some((aura) => aura.id === WARD_CYCLE_ICD_ID)
  ) {
    return;
  }
  const ward = player.auras.find(
    (aura) => aura.id === 'lightning_shield' && aura.kind === 'thorns',
  );
  if (ward) {
    const resolved = ctx.resolvedAbility('lightning_shield', player.id);
    const cap = resolved?.effects.find((effect) => effect.type === 'selfBuff')?.charges ?? 3;
    ward.charges = Math.min(cap, (ward.charges ?? cap) + 1);
  }
  if (player.resourceType === 'mana') {
    player.resource = Math.min(player.maxResource, player.resource + 10);
  }
  applyInternalState(ctx, player, WARD_CYCLE_ICD_ID, 'Ward Cycle', 6);
}

export function onShamanCastCompleted(ctx: SimContext, player: Entity, abilityId: string): void {
  if (!shamanMeta(ctx, player)) return;
  if (abilityId === 'ghost_wolf') {
    if (player.auras.some((aura) => aura.id === 'ghost_wolf')) onGhostWolfEntered(ctx, player);
    else onGhostWolfExited(ctx, player);
  }
  if (
    JOLT_IDS.has(abilityId) &&
    shamanTalentSelected(ctx, player, SHAMAN_TALENT_IDS.flowingElements)
  ) {
    ctx.applyAura(player, {
      id: FLOWING_ELEMENTS_ID,
      name: 'Flowing Elements',
      kind: 'ice_floes',
      value: 1,
      remaining: 8,
      duration: 8,
      sourceId: player.id,
      school: 'nature',
      empowerAbilities: [...FLOWING_ABILITIES],
    });
  }
}

export function onThunderWardActivated(ctx: SimContext, player: Entity): void {
  if (
    !shamanTalentSelected(ctx, player, SHAMAN_TALENT_IDS.ancestralBulwark) ||
    player.auras.some((aura) => aura.id === ANCESTRAL_BULWARK_ICD_ID)
  ) {
    return;
  }
  ctx.applyAura(player, {
    id: 'shaman_ancestral_bulwark',
    name: 'Ancestral Bulwark',
    kind: 'buff_dr',
    value: 0.4,
    remaining: 6,
    duration: 6,
    sourceId: player.id,
    school: 'nature',
  });
  applyInternalState(ctx, player, ANCESTRAL_BULWARK_ICD_ID, 'Ancestral Bulwark', 120);
}

export function onThunderWardRetaliated(ctx: SimContext, player: Entity): void {
  if (!shamanTalentSelected(ctx, player, SHAMAN_TALENT_IDS.wardedElements)) return;
  ctx.applyAura(player, {
    id: 'shaman_warded_elements',
    name: 'Warded Elements',
    kind: 'buff_dr',
    value: 0.1,
    remaining: 3,
    duration: 3,
    sourceId: player.id,
    school: 'nature',
  });
}

export function onGhostWolfEntered(ctx: SimContext, player: Entity): void {
  if (!shamanMeta(ctx, player)) return;
  if (shamanTalentSelected(ctx, player, SHAMAN_TALENT_IDS.wolfstep)) {
    for (let index = player.auras.length - 1; index >= 0; index--) {
      const aura = player.auras[index];
      if (aura.kind === 'root' || aura.kind === 'slow') removeAuraAt(ctx, player, index);
    }
  }
  if (
    shamanTalentSelected(ctx, player, SHAMAN_TALENT_IDS.gatheringWinds) &&
    !player.auras.some((aura) => aura.id === GATHERING_WINDS_ICD_ID)
  ) {
    ctx.applyAura(player, {
      id: 'shaman_gathering_winds',
      name: 'Gathering Winds',
      kind: 'buff_speed',
      value: 1.6,
      remaining: 3,
      duration: 3,
      sourceId: player.id,
      school: 'nature',
    });
    applyInternalState(ctx, player, GATHERING_WINDS_ICD_ID, 'Gathering Winds', 20);
  }
}

export function onGhostWolfExited(ctx: SimContext, player: Entity): void {
  if (
    !shamanTalentSelected(ctx, player, SHAMAN_TALENT_IDS.wayfarerGrace) ||
    player.auras.some((aura) => aura.id === WAYFARER_GRACE_ICD_ID)
  ) {
    return;
  }
  ctx.applyAura(player, {
    id: WAYFARER_GRACE_ID,
    name: 'Wayfarer Grace',
    kind: 'ice_floes',
    value: 99,
    remaining: 8,
    duration: 8,
    sourceId: player.id,
    school: 'nature',
  });
  applyInternalState(ctx, player, WAYFARER_GRACE_ICD_ID, 'Wayfarer Grace', 90);
}

const SHAMAN_STATE_TALENT = new Map<string, ShamanTalentId>([
  [STONEWARD_ID, SHAMAN_TALENT_IDS.stoneward],
  [PRIMAL_EXALTATION_ID, SHAMAN_TALENT_IDS.primalExaltation],
  [FLOWING_ELEMENTS_ID, SHAMAN_TALENT_IDS.flowingElements],
  [WAYFARER_GRACE_ID, SHAMAN_TALENT_IDS.wayfarerGrace],
  [FLOW_STATE_PROGRESS_ID, SHAMAN_TALENT_IDS.flowState],
  [FLOW_STATE_READY_ID, SHAMAN_TALENT_IDS.flowState],
  [WARD_CYCLE_ICD_ID, SHAMAN_TALENT_IDS.wardCycle],
  [GATHERING_WINDS_ICD_ID, SHAMAN_TALENT_IDS.gatheringWinds],
  [WAYFARER_GRACE_ICD_ID, SHAMAN_TALENT_IDS.wayfarerGrace],
  [ANCESTRAL_BULWARK_ICD_ID, SHAMAN_TALENT_IDS.ancestralBulwark],
  ['shaman_gathering_winds', SHAMAN_TALENT_IDS.gatheringWinds],
  ['shaman_ancestral_bulwark', SHAMAN_TALENT_IDS.ancestralBulwark],
  ['shaman_warded_elements', SHAMAN_TALENT_IDS.wardedElements],
  ['shaman_pyrebrand_mastery', SHAMAN_TALENT_IDS.imbueMastery],
  ['shaman_echoing_elements_damage', SHAMAN_TALENT_IDS.echoingElements],
  ['shaman_echoing_elements_stormcast', SHAMAN_TALENT_IDS.echoingElements],
  ['shaman_echoing_elements_heal', SHAMAN_TALENT_IDS.echoingElements],
  ['shaman_living_weapon_bolt', SHAMAN_TALENT_IDS.livingWeapon],
  ['shaman_living_weapon_absorb', SHAMAN_TALENT_IDS.livingWeapon],
]);

export function clearShamanTalentState(
  ctx: SimContext,
  source: Entity,
  retainedTalentIds: ReadonlySet<string> | null = null,
): void {
  for (const entity of ctx.entities.values()) {
    for (let index = entity.auras.length - 1; index >= 0; index--) {
      const aura = entity.auras[index];
      const talentId = SHAMAN_STATE_TALENT.get(aura.id);
      if (
        aura.sourceId === source.id &&
        talentId !== undefined &&
        !retainedTalentIds?.has(talentId)
      ) {
        removeAuraAt(ctx, entity, index);
      }
    }
  }
}

export const SHAMAN_TALENT_STATE_DURATION = LONG_STATE_DURATION;
