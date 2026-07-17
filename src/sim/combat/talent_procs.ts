import type { ProcDef, ProcResponse } from '../content/talents';
import type { SimContext } from '../sim_context';
import type { Entity } from '../types';
import { detonateOwnedDot, rollOwnedDot } from './dot_mutation';

function state(player: Entity): NonNullable<Entity['procState']> {
  if (!player.procState) player.procState = { counters: {}, icds: {} };
  return player.procState;
}

export function tickProcState(player: Entity, dt: number): void {
  const procState = player.procState;
  if (!procState) return;
  for (const key of Object.keys(procState.icds)) {
    procState.icds[key] -= dt;
    if (procState.icds[key] <= 0) delete procState.icds[key];
  }
}

export function resetProcState(player: Entity): void {
  player.procState = undefined;
}

function procsFor(ctx: SimContext, player: Entity): ProcDef[] {
  const meta = ctx.players.get(player.id);
  if (!meta) return [];
  const mods = ctx.playerMods(meta);
  return mods.procs.filter(
    (def) =>
      (def.spec === undefined || def.spec === mods.spec) &&
      (def.requiresKnownAbility === undefined ||
        meta.known.some((ability) => ability.def.id === def.requiresKnownAbility)),
  );
}

function fire(
  ctx: SimContext,
  player: Entity,
  def: ProcDef,
  subject: Entity,
  landedDamage = 0,
): void {
  for (const response of def.responses) {
    fireOne(ctx, player, def, subject, response, landedDamage);
  }
}

function fireOne(
  ctx: SimContext,
  player: Entity,
  def: ProcDef,
  subject: Entity,
  response: ProcResponse,
  landedDamage: number,
): void {
  switch (response.kind) {
    case 'empowerNext': {
      const value =
        response.aura === 'next_ability_damage'
          ? (response.dmgPct ?? 0)
          : response.costPct !== undefined
            ? 1 - response.costPct
            : 0;
      const existing = player.auras.find(
        (aura) => aura.id === def.id && aura.sourceId === player.id,
      );
      if (existing) {
        existing.kind = response.aura;
        existing.remaining = response.duration;
        existing.duration = response.duration;
        existing.value = value;
        existing.empowerAbilities = response.abilities;
      } else {
        ctx.applyAura(player, {
          id: def.id,
          name: def.name,
          kind: response.aura,
          remaining: response.duration,
          duration: response.duration,
          value,
          sourceId: player.id,
          school: def.school ?? 'holy',
          empowerAbilities: response.abilities,
        });
      }
      ctx.emit({
        type: 'spellfx',
        sourceId: player.id,
        targetId: player.id,
        school: def.school ?? 'holy',
        fx: 'procSurge',
      });
      break;
    }
    case 'cooldownRefund': {
      const remaining = player.cooldowns.get(response.ability);
      if (remaining === undefined) break;
      if (response.seconds === 'reset' || remaining - response.seconds <= 0) {
        player.cooldowns.delete(response.ability);
      } else {
        player.cooldowns.set(response.ability, remaining - response.seconds);
      }
      break;
    }
    case 'resource':
      if (response.resourceType !== undefined && player.resourceType !== response.resourceType) {
        break;
      }
      player.resource = Math.min(
        player.maxResource,
        player.resource + (response.amount ?? player.maxResource * response.pctMax),
      );
      break;
    case 'stackAura': {
      const existing = player.auras.find(
        (aura) => aura.id === def.id && aura.sourceId === player.id,
      );
      if (existing) {
        existing.stacks = Math.min(response.maxStacks, (existing.stacks ?? 0) + 1);
        existing.remaining = response.duration;
        existing.duration = response.duration;
      } else {
        ctx.applyAura(player, {
          id: def.id,
          name: def.name,
          kind: response.aura,
          remaining: response.duration,
          duration: response.duration,
          value: 0,
          stacks: 1,
          sourceId: player.id,
          school: def.school ?? 'frost',
        });
      }
      ctx.emit({
        type: 'spellfx',
        sourceId: player.id,
        targetId: player.id,
        school: def.school ?? 'frost',
        fx: 'procSurge',
      });
      break;
    }
    case 'rollingDot': {
      const banked = rollOwnedDot(
        ctx,
        player,
        subject,
        {
          id: def.id,
          name: def.name,
          school: def.school ?? 'fire',
          pctDamage: response.pctDamage,
          duration: response.duration,
          interval: response.interval,
        },
        landedDamage,
      );
      if (banked > 0) {
        ctx.emit({
          type: 'spellfx',
          sourceId: player.id,
          targetId: subject.id,
          school: def.school ?? 'fire',
          fx: 'procSurge',
        });
      }
      break;
    }
    case 'detonateOwnedDot':
      if (landedDamage > 0) detonateOwnedDot(ctx, player, subject, response.auraId);
      break;
    case 'chanceAura': {
      // The response sits behind procsFor + the trigger's ability gate, so this is
      // the only draw: Frostbite rolls only after a landed Cryomancy Rimelance hit.
      if (!ctx.rng.chance(response.chance)) break;
      ctx.applyAura(player, {
        id: response.id,
        name: response.name,
        kind: response.aura,
        remaining: response.duration,
        duration: response.duration,
        value: 0,
        charges: response.charges,
        sourceId: player.id,
        school: def.school ?? 'frost',
      });
      break;
    }
    case 'addAuraCharges': {
      const aura = player.auras.find(
        (entry) => entry.id === response.ability && entry.sourceId === player.id,
      );
      if (!aura) break;
      aura.charges = Math.min(response.maxCharges, (aura.charges ?? 0) + response.amount);
      ctx.emit({
        type: 'spellfx',
        sourceId: player.id,
        targetId: player.id,
        school: def.school ?? 'nature',
        fx: 'procSurge',
      });
      break;
    }
    case 'heal':
      ctx.applyHeal(player, subject, response.amount ?? player.maxHp * response.pctMax, def.name);
      break;
    case 'absorb':
      ctx.applyAura(subject, {
        id: def.id,
        name: def.name,
        kind: 'absorb',
        remaining: response.duration,
        duration: response.duration,
        value: response.amount,
        sourceId: player.id,
        school: def.school ?? 'holy',
      });
      ctx.emit({
        type: 'spellfx',
        sourceId: player.id,
        targetId: subject.id,
        school: def.school ?? 'holy',
        fx: 'wardBloom',
      });
      break;
    case 'echo':
      ctx.applyAura(subject, {
        id: def.id,
        name: def.name,
        kind: 'heal_echo',
        remaining: response.window,
        duration: response.window,
        value: response.heal,
        value2: response.belowFrac,
        sourceId: player.id,
        school: 'holy',
      });
      break;
  }
}

export function onCastCompleted(
  ctx: SimContext,
  player: Entity,
  abilityId: string,
  target?: Entity | null,
): void {
  for (const def of procsFor(ctx, player)) {
    const trigger = def.trigger;
    if (trigger.on !== 'castNth' || !trigger.abilities.includes(abilityId)) continue;
    const procState = state(player);
    const count = (procState.counters[def.id] ?? 0) + 1;
    if (count >= trigger.n) {
      procState.counters[def.id] = 0;
      fire(ctx, player, def, target && !target.dead ? target : player);
    } else {
      procState.counters[def.id] = count;
    }
  }
}

export function onPetHit(ctx: SimContext, player: Entity, target: Entity): void {
  for (const def of procsFor(ctx, player)) {
    const trigger = def.trigger;
    if (trigger.on !== 'petHitNth') continue;
    const procState = state(player);
    const count = (procState.counters[def.id] ?? 0) + 1;
    if (count >= trigger.n) {
      procState.counters[def.id] = 0;
      fire(ctx, player, def, target);
    } else {
      procState.counters[def.id] = count;
    }
  }
}

export function onFreeCastConsumed(
  ctx: SimContext,
  player: Entity,
  abilityId: string,
  consumedAuraId: string,
): void {
  for (const def of procsFor(ctx, player)) {
    const refresh = def.refreshOnFreeCast;
    if (refresh?.ability !== abilityId || refresh.consumedAuraId !== consumedAuraId) continue;
    fire(ctx, player, def, player);
    return;
  }
}

export function onThornsReflect(ctx: SimContext, player: Entity, abilityId: string): void {
  for (const def of procsFor(ctx, player)) {
    const trigger = def.trigger;
    if (trigger.on === 'thornsReflect' && trigger.ability === abilityId) {
      fire(ctx, player, def, player);
    }
  }
}

export function onSpellCrit(
  ctx: SimContext,
  player: Entity,
  abilityId: string | null,
  target: Entity,
  landedDamage = 0,
): void {
  for (const def of procsFor(ctx, player)) {
    const trigger = def.trigger;
    if (trigger.on !== 'spellCrit') continue;
    if (trigger.abilities && (abilityId === null || !trigger.abilities.includes(abilityId))) {
      continue;
    }
    if (trigger.icd !== undefined) {
      const procState = state(player);
      if (procState.icds[def.id] !== undefined) continue;
      procState.icds[def.id] = trigger.icd;
    }
    fire(ctx, player, def, target, landedDamage);
  }
}

export function onSpellHit(
  ctx: SimContext,
  player: Entity,
  abilityId: string,
  target: Entity,
  landedDamage = 0,
): void {
  for (const def of procsFor(ctx, player)) {
    const trigger = def.trigger;
    if (trigger.on !== 'spellHit' || !trigger.abilities.includes(abilityId)) continue;
    fire(ctx, player, def, target, landedDamage);
  }
}

export function onRangedHit(
  ctx: SimContext,
  player: Entity,
  abilityId: string,
  target: Entity,
): void {
  for (const def of procsFor(ctx, player)) {
    const trigger = def.trigger;
    if (trigger.on !== 'rangedHit' || !trigger.abilities.includes(abilityId)) continue;
    fire(ctx, player, def, target);
  }
}

export function onShieldConsumed(
  ctx: SimContext,
  player: Entity,
  shieldAbilityId: string,
  owner: Entity,
): void {
  for (const def of procsFor(ctx, player)) {
    const trigger = def.trigger;
    if (trigger.on === 'shieldConsumed' && trigger.ability === shieldAbilityId) {
      fire(ctx, player, def, owner);
    }
  }
}

export function onHotExpired(
  ctx: SimContext,
  player: Entity,
  hotAbilityId: string,
  owner: Entity,
): void {
  for (const def of procsFor(ctx, player)) {
    const trigger = def.trigger;
    if (trigger.on === 'hotExpired' && trigger.ability === hotAbilityId) {
      fire(ctx, player, def, owner);
    }
  }
}

export function onDamageTaken(ctx: SimContext, player: Entity, amount: number): void {
  if (player.maxHp <= 0) return;
  for (const def of procsFor(ctx, player)) {
    const trigger = def.trigger;
    if (trigger.on !== 'bigHitTaken' || amount < player.maxHp * trigger.hpFrac) continue;
    const procState = state(player);
    if (procState.icds[def.id] !== undefined) continue;
    procState.icds[def.id] = trigger.icd;
    fire(ctx, player, def, player);
  }
}

export function onMeleeSwing(
  ctx: SimContext,
  player: Entity,
  abilityId = 'auto_attack',
  consumedEmpowerAuraId?: string,
): void {
  const activeProcs = procsFor(ctx, player);
  for (const def of activeProcs) {
    const trigger = def.trigger;
    if (trigger.on === 'meleeHit') {
      if (!trigger.abilities.includes(abilityId)) continue;
      const empowered = trigger.chanceWhenEmpowered;
      const chance =
        empowered !== undefined &&
        empowered.ability === abilityId &&
        empowered.auraId === consumedEmpowerAuraId &&
        activeProcs.some((candidate) => candidate.id === empowered.auraId)
          ? empowered.chance
          : trigger.chance;
      if (chance !== undefined && !ctx.rng.chance(chance)) continue;
      fire(ctx, player, def, player);
      continue;
    }
    if (
      trigger.on === 'meleeSwingWhile' &&
      player.auras.some((aura) => aura.kind === trigger.auraKind)
    ) {
      const cadence = trigger.n ?? 1;
      if (cadence <= 1) {
        fire(ctx, player, def, player);
        continue;
      }
      const procState = state(player);
      const count = (procState.counters[def.id] ?? 0) + 1;
      if (count >= cadence) {
        procState.counters[def.id] = 0;
        fire(ctx, player, def, player);
      } else {
        procState.counters[def.id] = count;
      }
    }
  }
}
