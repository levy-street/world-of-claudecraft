import type { TalentAllocation } from '../content/talents';
import { pctValue } from '../entity';
import type { PlayerMeta, ResolvedAbility } from '../sim';
import type { SimContext } from '../sim_context';
import type { Entity } from '../types';
import { armorReduction, dist2d } from '../types';
import { replaceResolvedAbility } from './action_replacement';
import { livingGroupRaidInRadius } from './group_targeting';

const APEX_ID = 'hunter_apex_instinct';
const EFFICIENT_PROGRESS_ID = 'hunter_efficient_rhythm_progress';
const EFFICIENT_READY_ID = 'hunter_efficient_rhythm_ready';
const OVERDRAW_COUNTER_ID = 'hunter_overdraw_counter';
const CHAIN_USES_ID = 'hunter_chain_reaction_uses';
const FANG_COUNTER_ID = 'hunter_fang_chorus_counter';
const PREDATOR_PACE_ICD_ID = 'hunter_predators_pace_icd';
const ENDURING_COURSER_ICD_ID = 'hunter_enduring_courser_icd';
export const ENDURING_COURSER_BURST_ID = 'hunter_enduring_courser_burst';
const GUISE_MASTERY_ICD_ID = 'hunter_guise_mastery_icd';
const GUISE_HARRIER_ID = 'hunter_guise_harrier';
const GUISE_MARTEN_ID = 'hunter_guise_marten';
const GUISE_COURSER_ID = 'hunter_guise_courser';
const LONG_STATE_DURATION = 86_400;

const FOCUS_SPENDERS = new Set(['arcane_shot', 'aimed_shot', 'mongoose_bite']);
const FOCUS_GENERATORS = new Set(['pack_command', 'measured_shot', 'raptor_strike']);
export const PACK_FEROCITY_DAMAGE_PER_STACK = 0.1;

function removeAura(ctx: SimContext, entity: Entity, id: string): void {
  const index = entity.auras.findIndex((aura) => aura.id === id);
  if (index < 0) return;
  const [aura] = entity.auras.splice(index, 1);
  ctx.emit({ type: 'aura', targetId: entity.id, name: aura.name, gained: false });
}

function applyStateAura(
  ctx: SimContext,
  entity: Entity,
  id: string,
  name: string,
  duration: number,
  value: number,
  stacks?: number,
): void {
  ctx.applyAura(entity, {
    id,
    name,
    kind: 'internal_cd',
    remaining: duration,
    duration,
    value,
    stacks,
    sourceId: entity.id,
    school: 'physical',
  });
}

export function hasHunterTalent(meta: PlayerMeta, talentId: string): boolean {
  return meta.cls === 'hunter' && hunterTalentSelected(meta.talents, talentId);
}

export function hunterFerocityDamageMultiplier(hunter: Entity | null | undefined): number {
  const aura = hunter?.auras.find((candidate) => candidate.kind === 'hunter_ferocity');
  const stacks = Math.min(3, Math.max(0, Math.trunc(aura?.stacks ?? aura?.value ?? 0)));
  return 1 + stacks * PACK_FEROCITY_DAMAGE_PER_STACK;
}

export function hunterPetFerocityDamageMultiplier(ctx: SimContext, pet: Entity): number {
  if (pet.ownerId === null) return 1;
  return hunterFerocityDamageMultiplier(ctx.entities.get(pet.ownerId));
}

function hunterTalentSelected(talents: TalentAllocation, talentId: string): boolean {
  return Object.values(talents.rows).includes(talentId);
}

function isFocusSpender(abilityId: string): boolean {
  return FOCUS_SPENDERS.has(abilityId);
}

function isFocusGenerator(abilityId: string): boolean {
  return FOCUS_GENERATORS.has(abilityId);
}

export function resolveHunterSharedAbility(
  base: ResolvedAbility,
  hunter: Entity,
  meta: PlayerMeta,
): ResolvedAbility {
  if (meta.cls !== 'hunter') return base;
  return resolveHunterSharedAbilityForTalents(base, hunter, meta.talents);
}

export function resolveHunterSharedAbilityForTalents(
  base: ResolvedAbility,
  hunter: Entity,
  talents: TalentAllocation,
): ResolvedAbility {
  let resolved = base;
  if (base.def.id === 'shellskin' && hunterTalentSelected(talents, 'hun_r17_shell_and_fang')) {
    resolved = {
      ...resolved,
      effects: resolved.effects.map((effect) =>
        effect.type === 'selfBuff' && effect.kind === 'shield_wall'
          ? { ...effect, value: 0.4 }
          : effect,
      ),
    };
  }
  if (
    resolved.def.id === 'aspect_of_the_cheetah' &&
    hunter.inCombat &&
    hunterTalentSelected(talents, 'hun_r17_pack_rally') &&
    !hunter.cooldowns.has('pack_rally')
  ) {
    resolved = replaceResolvedAbility(resolved, 'pack_rally');
  }

  if (isFocusGenerator(resolved.def.id)) {
    const rhythmReady = hunter.auras.some((aura) => aura.id === EFFICIENT_READY_ID);
    const guiseMultiplier = hunter.auras.some((aura) => aura.id === GUISE_HARRIER_ID) ? 1.5 : 1;
    if (rhythmReady || guiseMultiplier !== 1) {
      resolved = {
        ...resolved,
        hunterRhythm: rhythmReady,
        effects: resolved.effects.map((effect) =>
          effect.type === 'gainResource'
            ? {
                ...effect,
                amount: Math.round(effect.amount * guiseMultiplier) + (rhythmReady ? 20 : 0),
              }
            : effect,
        ),
      };
    }
  }

  if (!isFocusSpender(resolved.def.id)) return resolved;
  const apex = hunter.auras.find((aura) => aura.id === APEX_ID && (aura.stacks ?? 0) > 0);
  const overdraw =
    hunterTalentSelected(talents, 'hun_r20_overdraw') &&
    (hunter.auras.find((aura) => aura.id === OVERDRAW_COUNTER_ID)?.value ?? 0) >= 2;
  if (!apex && !overdraw) return resolved;
  return {
    ...resolved,
    cost: apex ? Math.max(1, Math.round(resolved.cost * 0.5)) : resolved.cost,
    hunterApex: !!apex,
    hunterOverdraw: overdraw,
  };
}

function triggerPredatorsPace(ctx: SimContext, hunter: Entity, meta: PlayerMeta): void {
  if (!hasHunterTalent(meta, 'hun_r5_predators_pace')) return;
  if (hunter.auras.some((aura) => aura.id === PREDATOR_PACE_ICD_ID)) return;
  ctx.applyAura(hunter, {
    id: 'hunter_predators_pace',
    name: "Predator's Pace",
    kind: 'buff_speed',
    remaining: 3,
    duration: 3,
    value: 1.2,
    sourceId: hunter.id,
    school: 'physical',
  });
  applyStateAura(ctx, hunter, PREDATOR_PACE_ICD_ID, "Predator's Pace", 8, 1);
}

export function grantHunterFocus(
  ctx: SimContext,
  hunter: Entity,
  amount: number,
  abilityId: string,
  preResolved = false,
): number {
  const meta = ctx.players.get(hunter.id);
  if (!meta || meta.cls !== 'hunter' || hunter.resourceType !== 'focus') {
    hunter.resource = Math.min(hunter.maxResource, hunter.resource + amount);
    return amount;
  }
  let granted = amount;
  if (!preResolved && hunter.auras.some((aura) => aura.id === GUISE_HARRIER_ID)) {
    granted = Math.round(granted * 1.5);
  }
  const rhythmReady = hunter.auras.some((aura) => aura.id === EFFICIENT_READY_ID);
  if (!preResolved && rhythmReady) granted += 20;
  hunter.resource = Math.min(hunter.maxResource, hunter.resource + granted);
  if (rhythmReady && isFocusGenerator(abilityId)) removeAura(ctx, hunter, EFFICIENT_READY_ID);
  if (isFocusGenerator(abilityId)) triggerPredatorsPace(ctx, hunter, meta);
  return granted;
}

export function consumeResolvedHunterGenerator(
  ctx: SimContext,
  hunter: Entity,
  res: ResolvedAbility,
): void {
  if (res.hunterRhythm) removeAura(ctx, hunter, EFFICIENT_READY_ID);
  const meta = ctx.players.get(hunter.id);
  if (meta && isFocusGenerator(res.def.id)) triggerPredatorsPace(ctx, hunter, meta);
}

export function noteHunterFocusSpend(
  ctx: SimContext,
  hunter: Entity,
  meta: PlayerMeta,
  res: ResolvedAbility,
): void {
  if (meta.cls !== 'hunter' || hunter.resourceType !== 'focus' || !isFocusSpender(res.def.id)) {
    return;
  }
  if (res.hunterApex) {
    const apex = hunter.auras.find((aura) => aura.id === APEX_ID);
    if (apex) {
      apex.stacks = Math.max(0, (apex.stacks ?? 1) - 1);
      apex.value = apex.stacks;
      if ((apex.stacks ?? 0) <= 0) removeAura(ctx, hunter, APEX_ID);
    }
  }

  if (hasHunterTalent(meta, 'hun_r14_efficient_rhythm') && res.cost > 0) {
    const progress = hunter.auras.find((aura) => aura.id === EFFICIENT_PROGRESS_ID)?.value ?? 0;
    const total = progress + res.cost;
    if (total >= 75) {
      removeAura(ctx, hunter, EFFICIENT_PROGRESS_ID);
      applyStateAura(ctx, hunter, EFFICIENT_READY_ID, 'Efficient Rhythm', LONG_STATE_DURATION, 20);
    } else {
      applyStateAura(
        ctx,
        hunter,
        EFFICIENT_PROGRESS_ID,
        'Efficient Rhythm',
        LONG_STATE_DURATION,
        total,
      );
    }
  }

  if (hasHunterTalent(meta, 'hun_r20_overdraw')) {
    if (res.hunterOverdraw) {
      removeAura(ctx, hunter, OVERDRAW_COUNTER_ID);
    } else {
      const count = (hunter.auras.find((aura) => aura.id === OVERDRAW_COUNTER_ID)?.value ?? 0) + 1;
      applyStateAura(
        ctx,
        hunter,
        OVERDRAW_COUNTER_ID,
        'Overdraw',
        LONG_STATE_DURATION,
        Math.min(2, count),
      );
    }
  }
}

function petDamageMultiplier(ctx: SimContext, pet: Entity): number {
  let multiplier = 1;
  for (const aura of pet.auras) {
    if (aura.kind === 'pet_damage_pct') multiplier += pctValue(aura.value);
  }
  if (pet.ownerId !== null) {
    const ownerMeta = ctx.players.get(pet.ownerId);
    if (ownerMeta) multiplier *= 1 + ctx.playerMods(ownerMeta).global.petDmgPct;
  }
  multiplier *= hunterPetFerocityDamageMultiplier(ctx, pet);
  return multiplier;
}

function runFangChorus(ctx: SimContext, hunter: Entity, target: Entity): void {
  const meta = ctx.players.get(hunter.id);
  if (!meta || !hasHunterTalent(meta, 'hun_r20_fang_chorus')) return;
  const pet = ctx.petOf(hunter.id);
  if (!pet || pet.dead) return;
  const current = hunter.auras.find((aura) => aura.id === FANG_COUNTER_ID)?.value ?? 0;
  const clap = current >= 2;
  if (clap) removeAura(ctx, hunter, FANG_COUNTER_ID);
  else {
    applyStateAura(ctx, hunter, FANG_COUNTER_ID, 'Fang Chorus', LONG_STATE_DURATION, current + 1);
  }
  let damage =
    (ctx.rng.range(pet.weapon.min, pet.weapon.max) +
      (ctx.effectiveAttackPower(pet) / 14) * pet.weapon.speed) *
    0.5;
  damage *= petDamageMultiplier(ctx, pet);
  const targets = clap
    ? ctx
        .hostilesInRadius(pet, target.pos, 4)
        .filter((enemy) => !enemy.dead)
        .sort((a, b) => dist2d(a.pos, target.pos) - dist2d(b.pos, target.pos) || a.id - b.id)
    : [target];
  for (const enemy of targets) {
    const dealt = Math.max(
      1,
      Math.round(damage * (1 - armorReduction(ctx.effectiveArmor(enemy), pet.level))),
    );
    ctx.dealDamage(
      pet,
      enemy,
      dealt,
      false,
      'physical',
      clap ? 'Fang Chorus Clap' : 'Fang Chorus',
      'hit',
      true,
    );
  }
}

export function onHunterPrimaryDamage(
  ctx: SimContext,
  hunter: Entity,
  target: Entity,
  res: ResolvedAbility,
  dealt: number,
): void {
  if (dealt <= 0 || !isFocusSpender(res.def.id)) return;
  const multiplier = (res.hunterApex ? 1.2 : 1) * (res.hunterOverdraw ? 1.35 : 1);
  const bonus = Math.max(0, Math.round(dealt * (multiplier - 1)));
  if (bonus > 0) {
    ctx.dealDamage(
      hunter,
      target,
      bonus,
      false,
      res.def.school,
      res.def.name,
      'hit',
      false,
      undefined,
      true,
    );
  }
  const finalDamage = dealt + bonus;
  if (res.hunterOverdraw) {
    const cleave = Math.max(1, Math.round(finalDamage * 0.5));
    const nearby = ctx
      .hostilesInRadius(hunter, target.pos, 5)
      .filter((enemy) => enemy.id !== target.id && !enemy.dead)
      .sort((a, b) => dist2d(a.pos, target.pos) - dist2d(b.pos, target.pos) || a.id - b.id)
      .slice(0, 2);
    for (const enemy of nearby) {
      ctx.dealDamage(
        hunter,
        enemy,
        cleave,
        false,
        res.def.school,
        'Overdraw',
        'hit',
        false,
        undefined,
        true,
      );
    }
  }

  const markId = `hunter_chain_mark_${hunter.id}`;
  const uses = hunter.auras.find((aura) => aura.id === CHAIN_USES_ID);
  if (uses && target.auras.some((aura) => aura.id === markId)) {
    const echoes = [...ctx.entities.values()]
      .filter(
        (enemy) =>
          enemy.id !== target.id &&
          !enemy.dead &&
          ctx.isHostileTo(hunter, enemy) &&
          enemy.auras.some((aura) => aura.id === markId),
      )
      .sort((a, b) => a.id - b.id);
    for (const enemy of echoes) {
      ctx.dealDamage(
        hunter,
        enemy,
        Math.max(1, Math.round(finalDamage * 0.4)),
        false,
        res.def.school,
        'Chain Reaction',
        'hit',
        false,
        undefined,
        true,
      );
    }
    uses.stacks = Math.max(0, (uses.stacks ?? 1) - 1);
    uses.value = uses.stacks;
    if ((uses.stacks ?? 0) <= 0) removeAura(ctx, hunter, CHAIN_USES_ID);
  }
  runFangChorus(ctx, hunter, target);
}

export function activateHunterMajorWindow(ctx: SimContext, hunter: Entity, duration: number): void {
  const meta = ctx.players.get(hunter.id);
  if (!meta || !hasHunterTalent(meta, 'hun_r17_apex_instinct')) return;
  hunter.resource = Math.min(hunter.maxResource, hunter.resource + 40);
  applyStateAura(ctx, hunter, APEX_ID, 'Apex Instinct', duration + 4, 3, 3);
}

export function cancelRecedingShell(
  ctx: SimContext,
  hunter: Entity,
  meta: PlayerMeta,
  abilityId: string,
): boolean {
  if (abilityId !== 'shellskin' || !hasHunterTalent(meta, 'hun_r8_receding_shell')) return false;
  const shell = hunter.auras.find((aura) => aura.id === 'shellskin');
  if (!shell) return false;
  const refund = Math.min(45, shell.remaining * 0.5);
  removeAura(ctx, hunter, 'shellskin');
  const cooldown = hunter.cooldowns.get('shellskin');
  if (cooldown !== undefined) {
    const next = cooldown - refund;
    if (next <= 0) hunter.cooldowns.delete('shellskin');
    else hunter.cooldowns.set('shellskin', next);
  }
  return true;
}

export function onHunterTrailbreak(ctx: SimContext, hunter: Entity): void {
  const meta = ctx.players.get(hunter.id);
  if (!meta || !hasHunterTalent(meta, 'hun_r5_tactical_retreat')) return;
  for (let index = hunter.auras.length - 1; index >= 0; index--) {
    const aura = hunter.auras[index];
    if (aura.kind !== 'root' && aura.kind !== 'slow') continue;
    hunter.auras.splice(index, 1);
    ctx.emit({ type: 'aura', targetId: hunter.id, name: aura.name, gained: false });
  }
}

export function onHunterGuiseActivated(
  ctx: SimContext,
  hunter: Entity,
  meta: PlayerMeta,
  abilityId: string,
): void {
  if (abilityId === 'aspect_of_the_cheetah' && hasHunterTalent(meta, 'hun_r5_enduring_courser')) {
    if (!hunter.auras.some((aura) => aura.id === ENDURING_COURSER_ICD_ID)) {
      ctx.applyAura(hunter, {
        id: ENDURING_COURSER_BURST_ID,
        name: 'Enduring Courser',
        kind: 'buff_speed',
        remaining: 3,
        duration: 3,
        value: 1.6,
        sourceId: hunter.id,
        school: 'nature',
      });
      applyStateAura(ctx, hunter, ENDURING_COURSER_ICD_ID, 'Enduring Courser', 20, 1);
    }
  }
  if (!hasHunterTalent(meta, 'hun_r14_guise_mastery')) return;
  if (hunter.auras.some((aura) => aura.id === GUISE_MASTERY_ICD_ID)) return;
  if (abilityId === 'aspect_of_the_hawk') {
    applyStateAura(ctx, hunter, GUISE_HARRIER_ID, 'Guise Mastery: Harrier', 6, 1.5);
  } else if (abilityId === 'aspect_of_the_monkey') {
    ctx.applyAura(hunter, {
      id: GUISE_MARTEN_ID,
      name: 'Guise Mastery: Marten',
      kind: 'shield_wall',
      remaining: 6,
      duration: 6,
      value: 0.25,
      sourceId: hunter.id,
      school: 'nature',
    });
  } else if (abilityId === 'aspect_of_the_cheetah') {
    ctx.applyAura(hunter, {
      id: GUISE_COURSER_ID,
      name: 'Guise Mastery: Courser',
      kind: 'buff_speed',
      remaining: 6,
      duration: 6,
      value: hasHunterTalent(meta, 'hun_r5_enduring_courser') ? 1.6 : 1.5,
      sourceId: hunter.id,
      school: 'nature',
    });
  } else {
    return;
  }
  applyStateAura(ctx, hunter, GUISE_MASTERY_ICD_ID, 'Guise Mastery', 20, 1);
}

export function runHunterWildheart(ctx: SimContext, hunter: Entity): void {
  const meta = ctx.players.get(hunter.id);
  if (!meta || !hasHunterTalent(meta, 'hun_r8_shared_recovery')) return;
  const pet = ctx.petOf(hunter.id);
  const recipients = pet && !pet.dead ? [hunter, pet] : [hunter];
  if (pet && !pet.dead) {
    const heal = Math.min(Math.round(pet.maxHp * 0.3), pet.maxHp - pet.hp);
    if (heal > 0) {
      pet.hp += heal;
      ctx.emit({
        type: 'heal2',
        sourceId: hunter.id,
        targetId: pet.id,
        amount: heal,
        crit: false,
        ability: 'Shared Recovery',
      });
      ctx.healingThreat(hunter, pet, heal);
    }
  }
  for (const recipient of recipients) {
    ctx.applyAura(recipient, {
      id: `hunter_shared_recovery_${hunter.id}`,
      name: 'Shared Recovery',
      kind: 'shield_wall',
      remaining: 4,
      duration: 4,
      value: 0.2,
      sourceId: hunter.id,
      school: 'nature',
    });
  }
}

export function runHunterPackRally(
  ctx: SimContext,
  hunter: Entity,
  duration: number,
  radius: number,
): void {
  const recipients = livingGroupRaidInRadius(ctx, hunter, radius);
  const pet = ctx.petOf(hunter.id);
  if (pet && !pet.dead && dist2d(pet.pos, hunter.pos) <= radius) recipients.push(pet);
  for (const recipient of recipients) {
    ctx.applyAura(recipient, {
      id: 'hunter_pack_rally_speed',
      name: 'Pack Rally',
      kind: 'buff_speed',
      remaining: duration,
      duration,
      value: 1.3,
      sourceId: hunter.id,
      school: 'nature',
    });
    ctx.applyAura(recipient, {
      id: 'hunter_pack_rally_haste',
      name: 'Pack Rally',
      kind: 'buff_haste',
      remaining: duration,
      duration,
      value: 1.1,
      sourceId: hunter.id,
      school: 'nature',
    });
    ctx.applyAura(recipient, {
      id: 'hunter_pack_rally_spellhaste',
      name: 'Pack Rally',
      kind: 'buff_spellhaste',
      remaining: duration,
      duration,
      value: 1.1,
      sourceId: hunter.id,
      school: 'nature',
    });
  }
}

export function cripplingPursuit(
  ctx: SimContext,
  hunter: Entity,
  target: Entity,
  abilityId: string,
  alreadySlowed: boolean,
): void {
  const meta = ctx.players.get(hunter.id);
  if (
    !meta ||
    !hasHunterTalent(meta, 'hun_r11_crippling_pursuit') ||
    !alreadySlowed ||
    (abilityId !== 'concussive_shot' && abilityId !== 'wing_clip')
  ) {
    return;
  }
  const icdId = `hunter_crippling_pursuit_${hunter.id}`;
  if (target.auras.some((aura) => aura.id === icdId)) return;
  ctx.applyAura(target, {
    id: `hunter_crippling_root_${hunter.id}`,
    name: 'Crippling Pursuit',
    kind: 'root',
    remaining: 2,
    duration: 2,
    value: 0,
    sourceId: hunter.id,
    school: 'physical',
  });
  ctx.applyAura(target, {
    id: icdId,
    name: 'Crippling Pursuit',
    kind: 'internal_cd',
    remaining: 12,
    duration: 12,
    value: 1,
    sourceId: hunter.id,
    school: 'physical',
  });
}

export function hunterBindingPayload(meta: PlayerMeta): boolean {
  return hasHunterTalent(meta, 'hun_r11_binding_payload');
}

export function onHunterTrapTriggered(
  ctx: SimContext,
  hunter: Entity,
  center: Entity['pos'],
): void {
  const meta = ctx.players.get(hunter.id);
  if (!meta) return;
  if (hasHunterTalent(meta, 'hun_r14_trapcraft')) {
    hunter.resource = Math.min(hunter.maxResource, hunter.resource + 20);
    const cooldown = hunter.cooldowns.get('trailbreak');
    if (cooldown !== undefined) {
      if (cooldown <= 5) hunter.cooldowns.delete('trailbreak');
      else hunter.cooldowns.set('trailbreak', cooldown - 5);
    }
  }
  if (!hasHunterTalent(meta, 'hun_r20_chain_reaction')) return;
  const markId = `hunter_chain_mark_${hunter.id}`;
  for (const enemy of ctx.hostilesInRadius(hunter, center, 4)) {
    if (enemy.dead) continue;
    ctx.applyAura(enemy, {
      id: markId,
      name: 'Chain Reaction',
      kind: 'internal_cd',
      remaining: 8,
      duration: 8,
      value: 1,
      sourceId: hunter.id,
      school: 'physical',
    });
  }
  applyStateAura(ctx, hunter, CHAIN_USES_ID, 'Chain Reaction', 8, 3, 3);
}

export function breakEnduringCourserBurst(ctx: SimContext, hunter: Entity): void {
  removeAura(ctx, hunter, ENDURING_COURSER_BURST_ID);
}

export function clearHunterTalentState(ctx: SimContext, hunter: Entity): void {
  for (const id of [
    APEX_ID,
    EFFICIENT_PROGRESS_ID,
    EFFICIENT_READY_ID,
    OVERDRAW_COUNTER_ID,
    CHAIN_USES_ID,
    FANG_COUNTER_ID,
    PREDATOR_PACE_ICD_ID,
    ENDURING_COURSER_ICD_ID,
    ENDURING_COURSER_BURST_ID,
    GUISE_MASTERY_ICD_ID,
    GUISE_HARRIER_ID,
    GUISE_MARTEN_ID,
    GUISE_COURSER_ID,
  ]) {
    removeAura(ctx, hunter, id);
  }
  const markId = `hunter_chain_mark_${hunter.id}`;
  const pursuitIds = [
    `hunter_crippling_pursuit_${hunter.id}`,
    `hunter_crippling_root_${hunter.id}`,
  ];
  for (const entity of ctx.entities.values()) {
    entity.auras = entity.auras.filter(
      (aura) => aura.id !== markId && !pursuitIds.includes(aura.id),
    );
  }
  for (let index = ctx.groundAoEs.length - 1; index >= 0; index--) {
    const effect = ctx.groundAoEs[index];
    if (effect.sourceId === hunter.id && effect.hunterTrap) ctx.groundAoEs.splice(index, 1);
  }
}
