import { isTemporaryNecromancyUndeadTemplateId } from '../content/necromancy';
import { MOBS } from '../data';
import { createMob } from '../entity';
import { petDamageMult } from '../pet/pet_ai';
import type { SimContext } from '../sim_context';
import { clearThreat } from '../threat';
import { type AbilityDef, armorReduction, type Entity } from '../types';
import {
  dominionSummonBlock,
  missingDominionTemplates,
  NECROMANCY_DOMINION_CAP,
  selectCorpseExplosionServant,
} from './necromancy_dominion';

export const SOUL_FRAGMENT_CAP = 5;
export const TEMPORARY_UNDEAD_CAP = NECROMANCY_DOMINION_CAP;
export const DEATH_ECHO_CAP = 3;
export const DEATH_ECHO_DURATION = 15;
export const DEATH_ECHO_CONSUME_RADIUS = 6;
export const LICH_SOUL_LANCE_PIERCE_RADIUS = 7;
export const LICH_SOUL_LANCE_PIERCE_TARGETS = 2;
export const LICH_SOUL_LANCE_PIERCE_MULT = 0.5;
export const OSSUARY_MARK_ABILITY_ID = 'ossuary_mark';
export const SOUL_LANCE_ABILITY_ID = 'soul_lance';
// Necromancy is the only Warlock spec with no repeatable self-heal (Sacrifice
// Undead, at level 17, eats a servant) while Hard Bargain sells health for mana
// from level 6. A DELIBERATE detonation (the Ossuary Mark recast) returns a
// quarter of the banked damage as health. A mark that merely EXPIRES pays
// nothing: the sustain is the reward for actively popping the mark, so the
// expiry path in combat/auras.ts keeps calling detonateOssuaryMark without the
// deliberate flag.
export const OSSUARY_DETONATE_HEAL_PCT = 0.25;
const DEATH_ECHO_ID_PREFIX = 'necromancy_death_echo_';
const FUNERAL_HARVEST_MARK_DURATION = 5;
const FUNERAL_HARVEST_LOCKOUT = 3;
const FUNERAL_HARVEST_ABILITY_ID = 'funeral_harvest';

export function isTemporaryNecromancyUndead(entity: Entity): boolean {
  return (
    entity.kind === 'mob' &&
    entity.ownerId !== null &&
    isTemporaryNecromancyUndeadTemplateId(entity.templateId)
  );
}

export function isNecromancyUndead(entity: Entity): boolean {
  return entity.templateId === 'graveguard' || isTemporaryNecromancyUndead(entity);
}

export function soulFragmentCount(entity: Entity): number {
  return entity.auras.find((aura) => aura.kind === 'soul_fragments')?.stacks ?? 0;
}

export function addSoulFragments(ctx: SimContext, owner: Entity, amount: number): void {
  const existing = owner.auras.find((aura) => aura.kind === 'soul_fragments');
  const next = Math.min(SOUL_FRAGMENT_CAP, soulFragmentCount(owner) + amount);
  if (existing) {
    existing.stacks = next;
    existing.value = next;
    existing.remaining = 3600;
    existing.duration = 3600;
    return;
  }
  ctx.applyAura(owner, {
    id: 'soul_fragments',
    name: 'Soul Fragments',
    kind: 'soul_fragments',
    remaining: 3600,
    duration: 3600,
    value: next,
    stacks: next,
    sourceId: owner.id,
    school: 'shadow',
  });
}

export function spendSoulFragments(owner: Entity, amount: number): boolean {
  const aura = owner.auras.find((candidate) => candidate.kind === 'soul_fragments');
  if (!aura || (aura.stacks ?? 0) < amount) return false;
  const next = (aura.stacks ?? 0) - amount;
  if (next <= 0) owner.auras.splice(owner.auras.indexOf(aura), 1);
  else {
    aura.stacks = next;
    aura.value = next;
  }
  return true;
}

export function deathEchoes(owner: Entity): Entity['auras'] {
  return owner.auras.filter((aura) => aura.kind === 'necromancy_death_echo');
}

function deathEchoDistanceSq(
  aura: Entity['auras'][number],
  position: { x: number; z: number },
): number {
  const dx = aura.value - position.x;
  const dz = (aura.value2 ?? 0) - position.z;
  return dx * dx + dz * dz;
}

function nearestDeathEcho(
  owner: Entity,
  position: { x: number; z: number },
  radius = DEATH_ECHO_CONSUME_RADIUS,
): Entity['auras'][number] | null {
  const radiusSq = radius * radius;
  let nearest: Entity['auras'][number] | null = null;
  let nearestDistanceSq = Number.POSITIVE_INFINITY;
  for (const aura of deathEchoes(owner)) {
    const distanceSq = deathEchoDistanceSq(aura, position);
    if (
      distanceSq > radiusSq ||
      distanceSq > nearestDistanceSq ||
      (distanceSq === nearestDistanceSq && nearest !== null && aura.id > nearest.id)
    ) {
      continue;
    }
    nearest = aura;
    nearestDistanceSq = distanceSq;
  }
  return nearest;
}

export function createDeathEcho(
  ctx: SimContext,
  owner: Entity,
  position: { x: number; z: number },
): void {
  const active = deathEchoes(owner);
  const occupiedIds = new Set(active.map((aura) => aura.id));
  let slot = -1;
  for (let candidate = 0; candidate < DEATH_ECHO_CAP; candidate++) {
    if (!occupiedIds.has(`${DEATH_ECHO_ID_PREFIX}${candidate}`)) {
      slot = candidate;
      break;
    }
  }

  let aura: Entity['auras'][number] | undefined;
  if (slot < 0) {
    aura = [...active].sort(
      (a, b) => a.remaining - b.remaining || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )[0];
    slot = Number.parseInt(aura.id.slice(DEATH_ECHO_ID_PREFIX.length), 10);
  }

  const id = `${DEATH_ECHO_ID_PREFIX}${slot}`;
  if (aura) {
    aura.value = position.x;
    aura.value2 = position.z;
    aura.remaining = DEATH_ECHO_DURATION;
    aura.duration = DEATH_ECHO_DURATION;
  } else {
    ctx.applyAura(owner, {
      id,
      name: 'Death Echo',
      kind: 'necromancy_death_echo',
      remaining: DEATH_ECHO_DURATION,
      duration: DEATH_ECHO_DURATION,
      value: position.x,
      value2: position.z,
      sourceId: owner.id,
      school: 'shadow',
    });
  }
  ctx.emit({
    type: 'spellfxAt',
    x: position.x,
    z: position.z,
    school: 'shadow',
    fx: 'burst',
    sourceId: owner.id,
    ability: 'death_echo',
  });
}

export function consumeDeathEcho(
  ctx: SimContext,
  owner: Entity,
  position: { x: number; z: number },
): boolean {
  const echo = nearestDeathEcho(owner, position);
  if (!echo) return false;
  owner.auras.splice(owner.auras.indexOf(echo), 1);
  ctx.emit({ type: 'aura', targetId: owner.id, name: echo.name, gained: false });
  return true;
}

export function clearDeathEchoes(ctx: SimContext, owner: Entity): void {
  for (let index = owner.auras.length - 1; index >= 0; index--) {
    const aura = owner.auras[index];
    if (aura.kind !== 'necromancy_death_echo') continue;
    owner.auras.splice(index, 1);
    ctx.emit({ type: 'aura', targetId: owner.id, name: aura.name, gained: false });
  }
}

export function pierceLichSoulLance(
  ctx: SimContext,
  owner: Entity,
  primary: Entity,
  landedDamage: number,
): void {
  if (landedDamage <= 0 || !owner.auras.some((aura) => aura.kind === 'form_lich')) {
    return;
  }

  const amount = Math.max(1, Math.round(landedDamage * LICH_SOUL_LANCE_PIERCE_MULT));
  const secondaries = ctx
    .hostilesInRadius(owner, primary.pos, LICH_SOUL_LANCE_PIERCE_RADIUS)
    .filter((candidate) => candidate.id !== primary.id && ctx.hasLineOfSight(owner, candidate))
    .sort((a, b) => {
      const aDx = a.pos.x - primary.pos.x;
      const aDz = a.pos.z - primary.pos.z;
      const bDx = b.pos.x - primary.pos.x;
      const bDz = b.pos.z - primary.pos.z;
      return aDx * aDx + aDz * aDz - (bDx * bDx + bDz * bDz) || a.id - b.id;
    })
    .slice(0, LICH_SOUL_LANCE_PIERCE_TARGETS);

  for (const secondary of secondaries) {
    ctx.emit({
      type: 'spellfx',
      sourceId: primary.id,
      targetId: secondary.id,
      school: 'shadow',
      fx: 'projectile',
      ability: SOUL_LANCE_ABILITY_ID,
    });
    ctx.dealDamage(
      owner,
      secondary,
      amount,
      false,
      'shadow',
      'Lich Soul Lance',
      'hit',
      true,
      undefined,
      false,
      false,
      true,
      'soul_lance_lich_pierce',
      false,
      undefined,
      true,
    );
  }
}

export function ownedNecromancyUndead(ctx: SimContext, ownerId: number): Entity[] {
  return [...ctx.entities.values()].filter(
    (entity) =>
      entity.kind === 'mob' &&
      entity.ownerId === ownerId &&
      !entity.dead &&
      isNecromancyUndead(entity),
  );
}

export function despawnTemporaryNecromancyUndead(ctx: SimContext, ownerId: number): void {
  for (const entity of [...ctx.entities.values()]) {
    if (entity.ownerId === ownerId && isTemporaryNecromancyUndead(entity)) {
      ctx.despawnPet(entity);
    }
  }
}

export function necromancyCastError(
  ctx: SimContext,
  owner: Entity,
  ability: AbilityDef,
  _aim?: { x: number; z: number } | null,
): string | null {
  if (
    ability.id === 'corpse_explosion' &&
    !selectCorpseExplosionServant(ownedNecromancyUndead(ctx, owner.id))
  ) {
    return 'That ability is not ready yet.';
  }
  const temporarySummon = ability.effects.find(
    (effect) => effect.type === 'summonUndead' && effect.temporary,
  );
  const checksSacrifice = ability.effects.some((effect) => effect.type === 'sacrificeUndead');
  const checksCommand = ability.effects.some((effect) => effect.type === 'commandUndead');
  const checksReapingCommand = ability.effects.some((effect) => effect.type === 'reapingCommand');
  if (!temporarySummon && !checksSacrifice && !checksCommand && !checksReapingCommand) return null;

  let hasTemporary = false;
  let hasUndead = false;
  for (const entity of ctx.entities.values()) {
    if (
      entity.kind !== 'mob' ||
      entity.ownerId !== owner.id ||
      entity.dead ||
      !isNecromancyUndead(entity)
    ) {
      continue;
    }
    hasUndead = true;
    if (isTemporaryNecromancyUndead(entity)) {
      hasTemporary = true;
    }
  }
  if (
    temporarySummon?.type === 'summonUndead' &&
    dominionSummonBlock(ownedNecromancyUndead(ctx, owner.id), temporarySummon.templateId)
  ) {
    return 'That ability is not ready yet.';
  }
  if (checksSacrifice && !hasTemporary) {
    return 'That ability is not ready yet.';
  }
  if ((checksCommand || checksReapingCommand) && !hasUndead) {
    return 'That ability is not ready yet.';
  }
  return null;
}

function createUndead(
  ctx: SimContext,
  owner: Entity,
  templateId: string,
  duration?: number,
  spawnAt?: { x: number; z: number },
): Entity | null {
  const template = MOBS[templateId];
  if (!template) return null;
  const count = ownedNecromancyUndead(ctx, owner.id).length;
  const angle = count * 2.2;
  const pet = createMob(
    ctx.nextId++,
    template,
    owner.level,
    spawnAt
      ? ctx.groundPos(spawnAt.x, spawnAt.z)
      : ctx.groundPos(owner.pos.x + Math.cos(angle) * 2, owner.pos.z + Math.sin(angle) * 2),
  );
  pet.ownerId = owner.id;
  pet.petMode = ctx.petOf(owner.id, true)?.petMode ?? 'defensive';
  pet.petAutoTaunt = template.petCanTaunt === true;
  pet.petAutoWaterJet = false;
  pet.petSkillTimer = 0;
  pet.petAutoSkill = false;
  pet.petManualTauntPending = false;
  pet.hostile = false;
  pet.aiState = 'idle';
  pet.aggroTargetId = null;
  pet.inCombat = false;
  pet.tappedById = null;
  pet.loot = null;
  pet.lootable = false;
  pet.wanderTarget = null;
  pet.despawnTimer = duration;
  clearThreat(pet);
  ctx.addEntity(pet);
  return pet;
}

export function summonUndead(
  ctx: SimContext,
  owner: Entity,
  templateId: string,
  temporary: boolean,
  duration?: number,
  spawnAt?: { x: number; z: number },
  bypassDominion = false,
): Entity | null {
  if (
    temporary &&
    !bypassDominion &&
    dominionSummonBlock(ownedNecromancyUndead(ctx, owner.id), templateId)
  ) {
    return null;
  }
  if (!temporary) {
    const existing = ctx.petOf(owner.id, true);
    if (existing) ctx.despawnPet(existing);
  }
  const summoned = createUndead(ctx, owner, templateId, temporary ? duration : undefined, spawnAt);
  const lichForm = owner.auras.find((aura) => aura.kind === 'form_lich');
  if (summoned && lichForm) {
    commandUndead(ctx, owner, lichForm.remaining, 0.5, 0.2, 'lich_form_army');
  }
  return summoned;
}

export function commandUndead(
  ctx: SimContext,
  owner: Entity,
  duration: number,
  dmgPct: number,
  hastePct: number,
  auraId = 'unholy_command',
): void {
  for (const undead of ownedNecromancyUndead(ctx, owner.id)) {
    ctx.applyAura(undead, {
      id: auraId,
      name: auraId === 'lich_form_army' ? 'Lich Form' : 'Unholy Command',
      kind: 'buff_dmg_done',
      remaining: duration,
      duration,
      value: dmgPct,
      sourceId: owner.id,
      school: 'shadow',
    });
    ctx.applyAura(undead, {
      id: `${auraId}_haste`,
      name: auraId === 'lich_form_army' ? 'Lich Form' : 'Unholy Command',
      kind: 'pet_spellhaste',
      remaining: duration,
      duration,
      value: hastePct,
      sourceId: owner.id,
      school: 'shadow',
    });
  }
}

function reapingDamage(ctx: SimContext, undead: Entity, target: Entity): number {
  let damage =
    (undead.weapon.min + undead.weapon.max) / 2 +
    (ctx.effectiveAttackPower(undead) / 14) * undead.weapon.speed;
  damage *= petDamageMult(ctx, undead);
  if (!MOBS[undead.templateId]?.petRanged) {
    damage *= 1 - armorReduction(ctx.effectiveArmor(target), undead.level);
  }
  return Math.max(1, Math.round(damage));
}

function applyReapingRider(
  ctx: SimContext,
  owner: Entity,
  undead: Entity,
  target: Entity,
  secondaries: readonly Entity[],
): void {
  if (target.dead) return;
  if (undead.templateId === 'graveguard') {
    if (target.kind === 'mob') ctx.applyTaunt(undead, target);
    ctx.applyAura(undead, {
      id: 'reaping_command_graveguard',
      name: 'Graveguard Brace',
      kind: 'shield_wall',
      remaining: 4,
      duration: 4,
      value: 0.3,
      sourceId: owner.id,
      school: 'shadow',
    });
    return;
  }
  if (undead.templateId === 'necromancy_skeletal_warrior') {
    ctx.applyAura(target, {
      id: 'reaping_command_warrior',
      name: 'Grave Pin',
      kind: 'slow',
      remaining: 4,
      duration: 4,
      value: 0.6,
      sourceId: owner.id,
      school: 'shadow',
    });
    return;
  }
  if (undead.templateId === 'necromancy_bone_mage') {
    ctx.applyAura(target, {
      id: 'reaping_command_bone_mage',
      name: 'Ossuary Breach',
      kind: 'spellvuln',
      remaining: 6,
      duration: 6,
      value: 0.08,
      sourceId: owner.id,
      school: 'shadow',
    });
    return;
  }
  if (undead.templateId === 'necromancy_gravewing') {
    for (const victim of [target, ...secondaries]) {
      if (victim.dead) continue;
      ctx.applyAura(victim, {
        id: 'reaping_command_gravewing',
        name: 'Gravewing Rend',
        kind: 'vulnerability',
        remaining: 5,
        duration: 5,
        value: 0.08,
        sourceId: owner.id,
        school: 'shadow',
      });
    }
  }
}

export function reapWithUndead(
  ctx: SimContext,
  owner: Entity,
  target: Entity,
  abilityName: string,
): void {
  const intents = ownedNecromancyUndead(ctx, owner.id)
    .sort((a, b) => a.id - b.id)
    .flatMap((undead) => {
      undead.aggroTargetId = target.id;
      undead.inCombat = true;
      if (!ctx.hasLineOfSight(undead, target)) return [];
      const ranged = MOBS[undead.templateId]?.petRanged;
      const school = ranged?.school ?? 'physical';
      const damage = reapingDamage(ctx, undead, target);
      const cleave = MOBS[undead.templateId]?.petCleave;
      const secondaries = cleave
        ? ctx
            .hostilesInRadius(undead, target.pos, cleave.radius)
            .filter(
              (candidate) =>
                candidate.id !== target.id &&
                candidate.id !== undead.id &&
                ctx.hasLineOfSight(undead, candidate),
            )
            .sort((a, b) => a.id - b.id)
        : [];
      return [{ undead, ranged, school, damage, cleave, secondaries }];
    });

  for (const { undead, ranged, school, damage, cleave, secondaries } of intents) {
    undead.aggroTargetId = target.id;
    undead.inCombat = true;
    ctx.emit({
      type: 'spellfx',
      sourceId: undead.id,
      targetId: target.id,
      school,
      fx: ranged ? 'heavyBolt' : 'selfCast',
      ability: 'reaping_command',
    });
    ctx.dealDamage(
      undead,
      target,
      damage,
      false,
      school,
      abilityName,
      'hit',
      true,
      undefined,
      true,
      false,
      false,
      'reaping_command',
    );

    applyReapingRider(ctx, owner, undead, target, secondaries);
    if (!cleave) continue;
    const cleaveDamage = Math.max(1, Math.round(damage * cleave.mult));
    for (const secondary of secondaries) {
      ctx.dealDamage(
        undead,
        secondary,
        cleaveDamage,
        false,
        'physical',
        abilityName,
        'hit',
        true,
        undefined,
        true,
        false,
        false,
        'reaping_command',
        true,
      );
    }
  }
}

function funeralHarvestOwner(ctx: SimContext, source: Entity): Entity | null {
  if (source.kind !== 'player' && !isNecromancyUndead(source)) return null;
  const owner =
    source.kind === 'player'
      ? source
      : source.ownerId !== null
        ? (ctx.entities.get(source.ownerId) ?? null)
        : null;
  if (!owner || owner.dead || owner.kind !== 'player') return null;
  const meta = ctx.players.get(owner.id);
  if (
    meta?.cls !== 'warlock' ||
    ctx.playerMods(meta).spec !== 'demonology' ||
    !meta.known.some((known) => known.def.id === FUNERAL_HARVEST_ABILITY_ID)
  ) {
    return null;
  }
  return owner;
}

function necromancyOwner(ctx: SimContext, ownerId: number, abilityId: string): Entity | null {
  const owner = ctx.entities.get(ownerId);
  if (!owner || owner.dead || owner.kind !== 'player') return null;
  const meta = ctx.players.get(owner.id);
  if (
    meta?.cls !== 'warlock' ||
    ctx.playerMods(meta).spec !== 'demonology' ||
    !meta.known.some((known) => known.def.id === abilityId)
  ) {
    return null;
  }
  return owner;
}

function activeOssuaryMark(
  ctx: SimContext,
  ownerId: number,
): { target: Entity; aura: Entity['auras'][number] } | null {
  for (const target of ctx.entities.values()) {
    const aura = target.auras.find(
      (candidate) =>
        candidate.id === OSSUARY_MARK_ABILITY_ID &&
        candidate.kind === 'necromancy_ossuary_mark' &&
        candidate.sourceId === ownerId,
    );
    if (aura) return { target, aura };
  }
  return null;
}

export function hasActiveOssuaryMark(ctx: SimContext, ownerId: number): boolean {
  return activeOssuaryMark(ctx, ownerId) !== null;
}

export function clearOssuaryMarks(ctx: SimContext, ownerId: number): void {
  for (const target of ctx.entities.values()) {
    for (let index = target.auras.length - 1; index >= 0; index--) {
      const aura = target.auras[index];
      if (
        aura.id !== OSSUARY_MARK_ABILITY_ID ||
        aura.kind !== 'necromancy_ossuary_mark' ||
        aura.sourceId !== ownerId
      ) {
        continue;
      }
      target.auras.splice(index, 1);
      ctx.emit({ type: 'aura', targetId: target.id, name: aura.name, gained: false });
    }
  }
  ctx.entities.get(ownerId)?.cooldowns.delete(OSSUARY_MARK_ABILITY_ID);
}

function removeOssuaryMark(ctx: SimContext, target: Entity, aura: Entity['auras'][number]): void {
  const index = target.auras.indexOf(aura);
  if (index < 0) return;
  target.auras.splice(index, 1);
  ctx.emit({ type: 'aura', targetId: target.id, name: aura.name, gained: false });
}

function ossuaryDeathBurst(
  ctx: SimContext,
  owner: Entity,
  target: Entity,
  storedDamage: number,
  radius: number,
): void {
  ctx.emit({
    type: 'spellfxAt',
    x: target.pos.x,
    z: target.pos.z,
    school: 'shadow',
    fx: 'nova',
    radius,
    sourceId: owner.id,
    ability: 'ossuary_mark_detonate',
  });
  if (storedDamage <= 0) return;
  for (const nearby of ctx.hostilesInRadius(owner, target.pos, radius)) {
    if (nearby.id === target.id) continue;
    ctx.dealDamage(
      owner,
      nearby,
      storedDamage,
      false,
      'shadow',
      'Ossuary Mark',
      'hit',
      true,
      undefined,
      false,
      false,
      true,
      OSSUARY_MARK_ABILITY_ID,
      true,
      undefined,
      true,
    );
  }
}

function grantOssuaryDeathFragment(ctx: SimContext, owner: Entity): void {
  if (soulFragmentCount(owner) < SOUL_FRAGMENT_CAP) addSoulFragments(ctx, owner, 1);
}

// Pay the deliberate-detonation sustain. Clamped to the owner's MISSING health
// so it can never overheal, and cast with canCrit = false: the return is a flat
// quarter of the bank and draws no rng, so the shared stream keeps its order.
// applyHeal emits the normal heal2 the client already renders for self-heals.
function healOssuaryDetonation(ctx: SimContext, owner: Entity, storedDamage: number): void {
  const missing = owner.maxHp - owner.hp;
  if (storedDamage <= 0 || missing <= 0) return;
  const amount = Math.min(missing, Math.round(storedDamage * OSSUARY_DETONATE_HEAL_PCT));
  if (amount <= 0) return;
  ctx.applyHeal(owner, owner, amount, 'Ossuary Mark', OSSUARY_MARK_ABILITY_ID, false);
}

// `deliberate` is the player-driven recast path (applyOrDetonateOssuaryMark).
// It defaults to false so the natural-expiry caller in combat/auras.ts keeps its
// old behavior: an expiring mark still bursts, but pays no health back.
export function detonateOssuaryMark(
  ctx: SimContext,
  target: Entity,
  aura: Entity['auras'][number],
  deliberate = false,
): void {
  const owner = necromancyOwner(ctx, aura.sourceId, OSSUARY_MARK_ABILITY_ID);
  removeOssuaryMark(ctx, target, aura);
  if (!owner || target.dead) return;
  const storedDamage = Math.max(0, Math.round(aura.damageAccrued ?? 0));
  ctx.emit({
    type: 'spellfx',
    sourceId: owner.id,
    targetId: target.id,
    school: 'shadow',
    fx: 'nova',
    ability: 'ossuary_mark_detonate',
  });
  const fragmentsBefore = soulFragmentCount(owner);
  if (storedDamage > 0) {
    ctx.dealDamage(
      owner,
      target,
      storedDamage,
      false,
      'shadow',
      'Ossuary Mark',
      'hit',
      true,
      undefined,
      true,
      false,
      true,
      OSSUARY_MARK_ABILITY_ID,
      false,
      undefined,
      true,
    );
  }
  if (deliberate) healOssuaryDetonation(ctx, owner, storedDamage);
  if (!target.dead) return;
  ossuaryDeathBurst(ctx, owner, target, storedDamage, aura.value3 ?? 6);
  if (soulFragmentCount(owner) === fragmentsBefore) grantOssuaryDeathFragment(ctx, owner);
}

export function applyOrDetonateOssuaryMark(
  ctx: SimContext,
  owner: Entity,
  target: Entity,
  duration: number,
  storedDamagePct: number,
  soulLanceBonusPct: number,
  deathRadius: number,
): void {
  const active = activeOssuaryMark(ctx, owner.id);
  if (active) {
    detonateOssuaryMark(ctx, active.target, active.aura, true);
    return;
  }
  ctx.applyAura(target, {
    id: OSSUARY_MARK_ABILITY_ID,
    name: 'Ossuary Mark',
    kind: 'necromancy_ossuary_mark',
    remaining: duration,
    duration,
    value: storedDamagePct,
    value2: soulLanceBonusPct,
    value3: deathRadius,
    damageAccrued: 0,
    sourceId: owner.id,
    school: 'shadow',
  });
  ctx.emit({
    type: 'spellfx',
    sourceId: owner.id,
    targetId: target.id,
    school: 'shadow',
    fx: 'selfCast',
    ability: OSSUARY_MARK_ABILITY_ID,
  });
  owner.cooldowns.set(OSSUARY_MARK_ABILITY_ID, 20);
}

export function recordOssuaryMarkDamage(
  source: Entity | null,
  target: Entity,
  actualDamage: number,
  abilityId: string | null,
): void {
  if (!source || actualDamage <= 0 || source.id === target.id) return;
  const mark = target.auras.find(
    (aura) =>
      aura.id === OSSUARY_MARK_ABILITY_ID &&
      aura.kind === 'necromancy_ossuary_mark' &&
      (source.id === aura.sourceId ||
        (source.ownerId === aura.sourceId && isNecromancyUndead(source))),
  );
  if (!mark) return;
  const storedPct = mark.value + (abilityId === SOUL_LANCE_ABILITY_ID ? (mark.value2 ?? 0) : 0);
  mark.damageAccrued = (mark.damageAccrued ?? 0) + actualDamage * storedPct;
}

export function markFuneralHarvestDamage(
  ctx: SimContext,
  source: Entity | null,
  target: Entity,
  actualDamage: number,
): void {
  if (!source || actualDamage <= 0 || source.id === target.id) return;
  const owner = funeralHarvestOwner(ctx, source);
  if (!owner || !ctx.isHostileTo(owner, target)) return;
  const existing = target.auras.find(
    (aura) =>
      aura.id === 'funeral_harvest_mark' &&
      aura.kind === 'necromancy_harvest_mark' &&
      aura.sourceId === owner.id,
  );
  if (existing) {
    existing.remaining = FUNERAL_HARVEST_MARK_DURATION;
    existing.duration = FUNERAL_HARVEST_MARK_DURATION;
    return;
  }
  ctx.applyAura(target, {
    id: 'funeral_harvest_mark',
    name: 'Funeral Harvest',
    kind: 'necromancy_harvest_mark',
    remaining: FUNERAL_HARVEST_MARK_DURATION,
    duration: FUNERAL_HARVEST_MARK_DURATION,
    value: 1,
    sourceId: owner.id,
    school: 'shadow',
  });
}

export function necromancyOnDeath(ctx: SimContext, target: Entity): void {
  const ossuaryOwners = new Set<number>();
  for (const marker of [...target.auras]) {
    if (marker.id !== OSSUARY_MARK_ABILITY_ID || marker.kind !== 'necromancy_ossuary_mark') {
      continue;
    }
    const owner = necromancyOwner(ctx, marker.sourceId, OSSUARY_MARK_ABILITY_ID);
    removeOssuaryMark(ctx, target, marker);
    if (!owner) continue;
    const storedDamage = Math.max(0, Math.round(marker.damageAccrued ?? 0));
    ossuaryDeathBurst(ctx, owner, target, storedDamage, marker.value3 ?? 6);
    grantOssuaryDeathFragment(ctx, owner);
    ossuaryOwners.add(owner.id);
  }
  for (const marker of target.auras) {
    if (marker.kind !== 'necromancy_harvest_mark') continue;
    const owner = ctx.entities.get(marker.sourceId);
    if (!owner || !funeralHarvestOwner(ctx, owner)) continue;
    if (ossuaryOwners.has(owner.id)) continue;
    if (soulFragmentCount(owner) >= SOUL_FRAGMENT_CAP) continue;
    if (owner.auras.some((aura) => aura.id === 'funeral_harvest_lockout')) continue;
    addSoulFragments(ctx, owner, 1);
    ctx.applyAura(owner, {
      id: 'funeral_harvest_lockout',
      name: 'Funeral Harvest',
      kind: 'internal_cd',
      remaining: FUNERAL_HARVEST_LOCKOUT,
      duration: FUNERAL_HARVEST_LOCKOUT,
      value: 0,
      sourceId: owner.id,
      school: 'shadow',
    });
  }
}

export function sacrificeDominionForCorpseExplosion(ctx: SimContext, owner: Entity): Entity | null {
  const victim = selectCorpseExplosionServant(ownedNecromancyUndead(ctx, owner.id));
  if (!victim) return null;
  ctx.emit({
    type: 'spellfxAt',
    x: victim.pos.x,
    z: victim.pos.z,
    school: 'shadow',
    fx: 'burst',
    sourceId: owner.id,
    ability: 'corpse_explosion_sacrifice',
  });
  ctx.despawnPet(victim);
  return victim;
}

export function sacrificeUndead(
  ctx: SimContext,
  owner: Entity,
  healPctMax: number,
  abilityName: string,
): void {
  const victim = ownedNecromancyUndead(ctx, owner.id)
    .filter(isTemporaryNecromancyUndead)
    .sort((a, b) => {
      const aHealth = a.maxHp > 0 ? a.hp / a.maxHp : 0;
      const bHealth = b.maxHp > 0 ? b.hp / b.maxHp : 0;
      return aHealth - bHealth || a.id - b.id;
    })[0];
  if (!victim) return;
  ctx.emit({
    type: 'spellfxAt',
    x: victim.pos.x,
    z: victim.pos.z,
    school: 'shadow',
    fx: 'soulTravel',
    targetId: owner.id,
    ability: 'sacrifice_undead',
  });
  ctx.despawnPet(victim);
  ctx.applyHeal(
    owner,
    owner,
    Math.round(owner.maxHp * healPctMax),
    abilityName,
    'sacrifice_undead',
    false,
  );
}

export function raiseArmyOfDead(ctx: SimContext, owner: Entity, duration: number): void {
  const facing = Number.isFinite(owner.facing) ? owner.facing : 0;
  const forwardX = Math.sin(facing);
  const forwardZ = Math.cos(facing);
  const rightX = Math.cos(facing);
  const rightZ = -Math.sin(facing);
  const portal = ctx.groundPos(owner.pos.x + forwardX * 2.5, owner.pos.z + forwardZ * 2.5);
  ctx.emit({
    type: 'spellfxAt',
    x: portal.x,
    z: portal.z,
    school: 'shadow',
    fx: 'burst',
    sourceId: owner.id,
    ability: 'army_of_the_dead',
  });
  const formation = [
    ['necromancy_skeletal_warrior', -1.15],
    ['necromancy_bone_mage', 0],
    ['necromancy_gravewing', 1.15],
  ] as const;
  // The duplicate gate: the Army fills only the archetypes the warlock is NOT
  // already fielding. Without it a standing Gravewing/Bone Mage is doubled for
  // the Army window, which is both the strongest burst outlier (a second full
  // Gravewing) and visually two identical servants on screen.
  const missing = new Set(missingDominionTemplates(ownedNecromancyUndead(ctx, owner.id)));
  for (const [templateId, lateral] of formation) {
    if (!missing.has(templateId)) continue;
    summonUndead(
      ctx,
      owner,
      templateId,
      true,
      duration,
      {
        x: portal.x + forwardX * 1.05 + rightX * lateral,
        z: portal.z + forwardZ * 1.05 + rightZ * lateral,
      },
      true,
    );
  }
}
