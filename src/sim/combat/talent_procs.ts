import type { ProcDef, ProcResponse } from '../content/talents';
import type { SimContext } from '../sim_context';
import type { Entity } from '../types';

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
  return meta ? ctx.playerMods(meta).procs : [];
}

function fire(ctx: SimContext, player: Entity, def: ProcDef, subject: Entity): void {
  for (const response of def.responses) fireOne(ctx, player, def, subject, response);
}

function fireOne(
  ctx: SimContext,
  player: Entity,
  def: ProcDef,
  subject: Entity,
  response: ProcResponse,
): void {
  switch (response.kind) {
    case 'empowerNext': {
      const existing = player.auras.find(
        (aura) => aura.id === def.id && aura.sourceId === player.id,
      );
      if (existing) {
        existing.kind = response.aura;
        existing.remaining = response.duration;
        existing.duration = response.duration;
        existing.value = response.costPct !== undefined ? 1 - response.costPct : 0;
        existing.empowerAbilities = response.abilities;
      } else {
        ctx.applyAura(player, {
          id: def.id,
          name: def.name,
          kind: response.aura,
          remaining: response.duration,
          duration: response.duration,
          value: response.costPct !== undefined ? 1 - response.costPct : 0,
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
      player.resource = Math.min(player.maxResource, player.resource + response.amount);
      break;
    case 'heal':
      ctx.applyHeal(player, subject, response.amount, def.name);
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
): void {
  for (const def of procsFor(ctx, player)) {
    const trigger = def.trigger;
    if (trigger.on !== 'spellCrit') continue;
    if (trigger.abilities && (abilityId === null || !trigger.abilities.includes(abilityId))) {
      continue;
    }
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

export function onMeleeSwing(ctx: SimContext, player: Entity): void {
  for (const def of procsFor(ctx, player)) {
    const trigger = def.trigger;
    if (trigger.on !== 'meleeSwingWhile') continue;
    if (!player.auras.some((aura) => aura.kind === trigger.auraKind)) continue;
    fire(ctx, player, def, player);
  }
}
