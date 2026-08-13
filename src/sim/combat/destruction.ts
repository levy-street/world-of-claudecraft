// Destruction warlock combat engine.
//
// Ruin is a deterministic 0..5 secondary resource carried by a visible aura.
// Gloom Bolt and Conflagrate generate it; Ruinbolt, Rain of Fire, and Duskfire
// spend it. Desolation is a short, stackable cast-shaping buff granted by
// Conflagrate. Ruinous Brand copies resolved direct damage without re-entering
// the ability dispatcher, so copies cannot generate Ruin or copy themselves.

import { createDemonPet } from '../pet/pet_commands';
import type { PlayerMeta, ResolvedAbility } from '../sim';
import type { SimContext } from '../sim_context';
import type { AbilityDef, Aura, Entity } from '../types';
import { grantShadowCredit } from './warlock_talents';

export const RUIN_MAX = 5;
export const RUIN_DURATION = 3600;
export const RUIN_OUT_OF_COMBAT_CAP = 3;
export const DESOLATION_MAX_STACKS = 2;
export const DESOLATION_DURATION = 15;
export const DESOLATION_RUINBOLT_CAST_MULT = 0.7;
export const RUINOUS_BRAND_CHARGES = 3;
export const RUINOUS_BRAND_COPY_PCT = 0.5;
export const RUINOUS_BRAND_SELF_PCT = 0.25;
export const RUINOUS_BRAND_DURATION = 15;
export const PYRE_COLOSSUS_DURATION = 30;
export const PYRE_AURA_INTERVAL = 2;
export const PYRE_AURA_RADIUS = 8;
export const PYRE_AURA_DAMAGE = 60;
export const PYRE_RUIN_INTERVAL = 1;

const RUIN_AURA_ID = 'destruction_ruin';
const DESOLATION_AURA_ID = 'desolation';
const BRAND_AURA_ID = 'ruinous_brand';
const DUSKFIRE_CLAIM_AURA_ID = 'duskfire_claim';

function isCommittedDestruction(ctx: SimContext, meta: PlayerMeta): boolean {
  return meta.cls === 'warlock' && ctx.playerMods(meta).spec === 'destruction';
}

function emitFade(ctx: SimContext, entity: Entity, aura: Aura): void {
  ctx.emit({
    type: 'aura',
    targetId: entity.id,
    name: aura.name,
    gained: false,
    auraKind: aura.kind,
  });
}

export function ruinAmount(entity: Entity): number {
  return ruinAmountFromAuras(entity.auras);
}

export function ruinAmountFromAuras(auras: readonly { kind: string; stacks?: number }[]): number {
  for (const aura of auras) {
    if (aura.kind === 'destruction_ruin') {
      return Math.max(0, Math.min(RUIN_MAX, aura.stacks ?? 1));
    }
  }
  return 0;
}

export function destructionProcGlowActive(
  auras: readonly { kind: string }[],
  abilityId: string,
): boolean {
  if (abilityId !== 'chaos_bolt' && abilityId !== 'rain_of_fire') return false;
  for (const aura of auras) {
    if (aura.kind === 'desolation') return true;
  }
  return false;
}

export function gainRuin(ctx: SimContext, player: Entity, amount: number): void {
  if (amount <= 0 || player.dead) return;
  const current = ruinAmount(player);
  const next = Math.min(RUIN_MAX, current + Math.floor(amount));
  if (next <= current) return;
  const aura = player.auras.find((candidate) => candidate.id === RUIN_AURA_ID);
  if (aura) {
    aura.stacks = next;
    aura.value = next;
    aura.remaining = RUIN_DURATION;
    aura.duration = RUIN_DURATION;
    return;
  }
  ctx.applyAura(player, {
    id: RUIN_AURA_ID,
    name: 'Ruin',
    kind: 'destruction_ruin',
    value: next,
    stacks: next,
    remaining: RUIN_DURATION,
    duration: RUIN_DURATION,
    sourceId: player.id,
    school: 'fire',
  });
}

export function regenerateRuinOutOfCombat(ctx: SimContext, player: Entity, meta: PlayerMeta): void {
  if (player.inCombat || !isCommittedDestruction(ctx, meta)) return;
  if (ruinAmount(player) >= RUIN_OUT_OF_COMBAT_CAP) return;
  gainRuin(ctx, player, 1);
}

export function spendRuin(ctx: SimContext, player: Entity, amount: number): boolean {
  const cost = Math.max(0, Math.floor(amount));
  if (cost === 0) return true;
  const index = player.auras.findIndex((candidate) => candidate.id === RUIN_AURA_ID);
  if (index < 0) return false;
  const aura = player.auras[index];
  const next = (aura.stacks ?? 1) - cost;
  if (next < 0) return false;
  if (next === 0) {
    player.auras.splice(index, 1);
    emitFade(ctx, player, aura);
  } else {
    aura.stacks = next;
    aura.value = next;
  }
  grantShadowCredit(ctx, player, cost, RUIN_MAX);
  return true;
}

export function hasBurningPact(player: Entity, target: Entity | null): boolean {
  return (
    target?.auras.some(
      (aura) =>
        aura.id === 'immolate' &&
        aura.kind === 'dot' &&
        aura.sourceId === player.id &&
        aura.remaining > 0,
    ) ?? false
  );
}

export function gainDesolation(ctx: SimContext, player: Entity): void {
  const aura = player.auras.find((candidate) => candidate.id === DESOLATION_AURA_ID);
  if (aura) {
    aura.stacks = Math.min(DESOLATION_MAX_STACKS, (aura.stacks ?? 1) + 1);
    aura.value = aura.stacks;
    aura.remaining = DESOLATION_DURATION;
    aura.duration = DESOLATION_DURATION;
    return;
  }
  ctx.applyAura(player, {
    id: DESOLATION_AURA_ID,
    name: 'Desolation',
    kind: 'desolation',
    value: 1,
    stacks: 1,
    remaining: DESOLATION_DURATION,
    duration: DESOLATION_DURATION,
    sourceId: player.id,
    school: 'fire',
  });
}

export function destructionCastTimeMult(player: Entity, abilityId: string): number {
  if (abilityId === 'chaos_bolt' && player.auras.some((aura) => aura.id === DESOLATION_AURA_ID)) {
    return DESOLATION_RUINBOLT_CAST_MULT;
  }
  return 1;
}

export function consumeDesolationForCast(
  ctx: SimContext,
  player: Entity,
  res: ResolvedAbility,
): ResolvedAbility {
  if (res.def.id !== 'chaos_bolt' && res.def.id !== 'rain_of_fire') return res;
  const index = player.auras.findIndex((candidate) => candidate.id === DESOLATION_AURA_ID);
  if (index < 0) return res;
  const aura = player.auras[index];
  const next = (aura.stacks ?? 1) - 1;
  if (next <= 0) {
    player.auras.splice(index, 1);
    emitFade(ctx, player, aura);
  } else {
    aura.stacks = next;
    aura.value = next;
  }
  if (res.def.id !== 'rain_of_fire') return res;
  return {
    ...res,
    effects: res.effects.map((effect) =>
      effect.type === 'groundAoE' ? { ...effect, delayed: false } : effect,
    ),
  };
}

export function advanceBurningPactTick(ctx: SimContext, player: Entity, target: Entity): void {
  const pact = target.auras.find(
    (aura) => aura.id === 'immolate' && aura.kind === 'dot' && aura.sourceId === player.id,
  );
  if (!pact) return;
  const interval = pact.tickInterval ?? 3;
  const copiedTick = Math.max(1, Math.round(pact.value));
  pact.remaining = Math.max(0, pact.remaining - interval);
  if (pact.remaining <= 0) {
    target.auras.splice(target.auras.indexOf(pact), 1);
    emitFade(ctx, target, pact);
  }
  ctx.dealDamage(
    player,
    target,
    copiedTick,
    false,
    pact.school,
    'Conflagrate',
    'hit',
    false,
    undefined,
    true,
    false,
    pact.finalDamage ?? false,
    'conflagrate',
  );
}

export function applyRuinousBrand(
  ctx: SimContext,
  player: Entity,
  target: Entity,
  duration = RUINOUS_BRAND_DURATION,
  charges = RUINOUS_BRAND_CHARGES,
): void {
  for (const entity of ctx.entities.values()) {
    for (let index = entity.auras.length - 1; index >= 0; index--) {
      const aura = entity.auras[index];
      if (aura.id !== BRAND_AURA_ID || aura.sourceId !== player.id) continue;
      entity.auras.splice(index, 1);
      emitFade(ctx, entity, aura);
    }
  }
  ctx.applyAura(target, {
    id: BRAND_AURA_ID,
    name: 'Ruinous Brand',
    kind: 'ruinous_brand',
    value: RUINOUS_BRAND_COPY_PCT,
    stacks: charges,
    remaining: duration,
    duration,
    sourceId: player.id,
    school: 'fire',
  });
  ctx.emit({
    type: 'spellfx',
    sourceId: player.id,
    targetId: target.id,
    school: 'fire',
    fx: 'selfCast',
    ability: 'ruinous_brand',
  });
}

export function applyDuskfireClaim(
  ctx: SimContext,
  player: Entity,
  target: Entity,
  duration: number,
): void {
  ctx.applyAura(target, {
    id: DUSKFIRE_CLAIM_AURA_ID,
    name: 'Duskfire Claim',
    kind: 'duskfire_claim',
    value: 1,
    remaining: duration,
    duration,
    sourceId: player.id,
    school: 'shadow',
  });
}

export function summonPyreColossus(
  ctx: SimContext,
  player: Entity,
  duration = PYRE_COLOSSUS_DURATION,
): void {
  const guardian = createDemonPet(ctx, player, 'pyre_colossus');
  if (!guardian) return;
  const landing = player.castAim ? ctx.groundPos(player.castAim.x, player.castAim.z) : player.pos;
  guardian.pos = { ...landing };
  guardian.spawnPos = { ...landing };
  ctx.rebucket(guardian);
  ctx.applyAura(guardian, {
    id: 'pyre_guardian',
    name: 'Pyre Guardian',
    kind: 'pyre_guardian',
    value: 0,
    remaining: duration,
    duration,
    sourceId: player.id,
    school: 'fire',
    tickInterval: PYRE_RUIN_INTERVAL,
    tickTimer: PYRE_RUIN_INTERVAL,
    icd: PYRE_AURA_INTERVAL,
  });
  ctx.emit({
    type: 'spellfxAt',
    x: landing.x,
    z: landing.z,
    school: 'fire',
    fx: 'meteorFall',
    radius: 6,
    duration: 0.35,
    sourceId: player.id,
    ability: 'summon_infernal',
  });
  ctx.emit({
    type: 'log',
    text: `${guardian.name} crashes into the battle.`,
    color: '#ff7a32',
    pid: player.id,
  });
}

export function tickPyreGuardian(ctx: SimContext, guardian: Entity, aura: Aura): void {
  if (guardian.templateId !== 'pyre_colossus' || aura.kind !== 'pyre_guardian') return;
  const owner = ctx.entities.get(aura.sourceId);
  if (!owner || owner.dead || owner.kind !== 'player') return;
  gainRuin(ctx, owner, 1);
  aura.icd = (aura.icd ?? PYRE_AURA_INTERVAL) - PYRE_RUIN_INTERVAL;
  if (aura.icd > 0) return;
  aura.icd += PYRE_AURA_INTERVAL;
  ctx.emit({
    type: 'spellfxAt',
    x: guardian.pos.x,
    z: guardian.pos.z,
    school: 'fire',
    fx: 'nova',
    radius: PYRE_AURA_RADIUS,
    sourceId: guardian.id,
    ability: 'summon_infernal',
  });
  for (const target of ctx.entities.values()) {
    if (target.dead || !ctx.isHostileTo(guardian, target)) continue;
    if (
      Math.hypot(target.pos.x - guardian.pos.x, target.pos.z - guardian.pos.z) > PYRE_AURA_RADIUS
    ) {
      continue;
    }
    ctx.dealDamage(
      guardian,
      target,
      PYRE_AURA_DAMAGE,
      false,
      'fire',
      'Pyre Aura',
      'hit',
      true,
      undefined,
      false,
      false,
      false,
      'summon_infernal',
      true,
    );
  }
}

export function destructionOnDeath(ctx: SimContext, target: Entity): void {
  const claims = target.auras.filter((aura) => aura.id === DUSKFIRE_CLAIM_AURA_ID);
  for (const claim of claims) {
    const source = ctx.entities.get(claim.sourceId);
    if (!source || source.dead || source.kind !== 'player') continue;
    const meta = ctx.players.get(source.id);
    if (!meta || !isCommittedDestruction(ctx, meta)) continue;
    gainRuin(ctx, source, Math.max(1, Math.floor(claim.value)));
  }
}

export function clearDestructionState(ctx: SimContext, player: Entity): void {
  const playerAuraIds = new Set([RUIN_AURA_ID, DESOLATION_AURA_ID]);
  const targetAuraIds = new Set([BRAND_AURA_ID, DUSKFIRE_CLAIM_AURA_ID]);
  for (const entity of ctx.entities.values()) {
    for (let index = entity.auras.length - 1; index >= 0; index--) {
      const aura = entity.auras[index];
      const playerState = entity.id === player.id && playerAuraIds.has(aura.id);
      const ownedTargetState = aura.sourceId === player.id && targetAuraIds.has(aura.id);
      if (!playerState && !ownedTargetState) continue;
      entity.auras.splice(index, 1);
      emitFade(ctx, entity, aura);
    }
  }
  const guardians = [...ctx.entities.values()].filter(
    (entity) => entity.ownerId === player.id && entity.templateId === 'pyre_colossus',
  );
  for (const guardian of guardians) ctx.despawnPet(guardian);
}

export function reserveRuinousBrandCopy(
  ctx: SimContext,
  player: Entity,
  meta: PlayerMeta,
  primary: Entity | null,
  res: ResolvedAbility,
): ResolvedAbility {
  if (res.def.class !== 'warlock' || !isCommittedDestruction(ctx, meta)) return res;
  if (!res.effects.some((effect) => effect.type === 'directDamage')) return res;
  let branded: Entity | null = null;
  let brand: Aura | null = null;
  for (const entity of ctx.entities.values()) {
    if (entity.dead || !ctx.isHostileTo(player, entity)) continue;
    const owned = entity.auras.find(
      (aura) => aura.id === BRAND_AURA_ID && aura.sourceId === player.id,
    );
    if (!owned) continue;
    branded = entity;
    brand = owned;
    break;
  }
  if (!branded || !brand) return res;
  const next = (brand.stacks ?? 1) - 1;
  if (next <= 0) {
    branded.auras.splice(branded.auras.indexOf(brand), 1);
    emitFade(ctx, branded, brand);
  } else {
    brand.stacks = next;
  }
  return {
    ...res,
    ruinousBrandCopy: {
      targetId: branded.id,
      value: branded.id === primary?.id ? RUINOUS_BRAND_SELF_PCT : brand.value,
    },
  };
}

function copyRuinousBrandDamage(
  ctx: SimContext,
  player: Entity,
  ability: AbilityDef,
  reservation: ResolvedAbility['ruinousBrandCopy'],
  resolvedDamage: number,
): void {
  if (!reservation || resolvedDamage <= 0) return;
  const branded = ctx.entities.get(reservation.targetId);
  if (!branded || branded.dead || !ctx.isHostileTo(player, branded)) return;
  const amount = Math.max(1, Math.round(resolvedDamage * reservation.value));
  ctx.emit({
    type: 'spellfx',
    sourceId: player.id,
    targetId: branded.id,
    school: ability.school,
    fx: ability.projectileFx ?? 'projectile',
    ability: ability.id,
  });
  ctx.dealDamage(
    player,
    branded,
    amount,
    false,
    ability.school,
    'Ruinous Brand',
    'hit',
    false,
    undefined,
    true,
    false,
    true,
    null,
    false,
    undefined,
    true,
  );
}

export function destructionAfterCast(
  ctx: SimContext,
  player: Entity,
  meta: PlayerMeta,
  res: ResolvedAbility,
  _target: Entity | null,
  resolvedDamage: number,
): void {
  const ability = res.def;
  if (ability.class !== 'warlock' || player.kind !== 'player') return;
  if (!isCommittedDestruction(ctx, meta)) return;
  if (ability.id === 'shadow_bolt') gainRuin(ctx, player, 1);
  if (ability.id === 'conflagrate') {
    gainRuin(ctx, player, 1);
    gainDesolation(ctx, player);
  }
  copyRuinousBrandDamage(ctx, player, ability, res.ruinousBrandCopy, resolvedDamage);
}
