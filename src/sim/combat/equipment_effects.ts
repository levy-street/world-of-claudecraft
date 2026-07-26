import { PROCEDURAL_LEGENDARY_POWERS } from '../content/procedural_legendary_powers';
import type { GroundAoE } from '../entity_roster';
import {
  EquipmentEffectRuntime,
  selectActiveEquipmentPower,
} from '../equipment/equipment_effect_runtime';
import type {
  ActiveEquipmentPower,
  EquipmentEffectCommand,
  EquipmentEffectEvent,
  EquippedPowerCandidate,
} from '../equipment/equipment_effect_types';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import type { Aura, Entity, EquipSlot } from '../types';

export type EquipmentEffectTriggerEvent = Omit<
  EquipmentEffectEvent,
  'nowMs' | 'actorId' | 'actorClass'
>;

function activePowerFor(meta: PlayerMeta): ActiveEquipmentPower | null {
  const candidates: EquippedPowerCandidate[] = [];
  for (const [slot, payload] of Object.entries(meta.equipmentInstance)) {
    if (!meta.equipment[slot as EquipSlot]) continue;
    const procedural = payload?.procedural;
    if (!procedural) continue;
    candidates.push({
      slot,
      uid: procedural.uid,
      powerId: procedural.legendaryPowerId,
    });
  }
  const selection = selectActiveEquipmentPower(candidates);
  if (selection.status !== 'active') return null;
  const payload = meta.equipmentInstance[selection.slot as EquipSlot]?.procedural;
  if (
    !payload ||
    payload.uid !== selection.uid ||
    payload.legendaryPowerId !== selection.powerId ||
    payload.powerRevision !== 1 ||
    !payload.legendaryRolls
  ) {
    return null;
  }
  return {
    powerId: selection.powerId,
    powerRevision: 1,
    itemLevel: payload.itemLevel,
    rolls: payload.legendaryRolls,
  };
}

function schoolFor(tag: string | undefined): Aura['school'] {
  switch (tag) {
    case 'bleed':
      return 'physical';
    case 'fire':
      return 'fire';
    case 'frost':
      return 'frost';
    case 'healing':
    case 'holy':
      return 'holy';
    case 'nature':
      return 'nature';
    case 'shadow':
      return 'shadow';
    default:
      return 'arcane';
  }
}

function durationSeconds(command: EquipmentEffectCommand): number {
  return Math.max(0.05, (command.durationMs ?? 1000) / 1000);
}

function eventBaseAmount(actor: Entity, event: EquipmentEffectTriggerEvent): number {
  if (event.amount !== undefined && Number.isFinite(event.amount) && event.amount > 0) {
    return event.amount;
  }
  return Math.max(
    1,
    Math.round(actor.level * 3 + actor.attackPower * 0.15 + actor.spellPower * 0.35),
  );
}

function scaledAmount(
  actor: Entity,
  event: EquipmentEffectTriggerEvent,
  command: EquipmentEffectCommand,
): number {
  return Math.max(1, Math.round(eventBaseAmount(actor, event) * (command.magnitude ?? 1)));
}

function commandTarget(ctx: SimContext, command: EquipmentEffectCommand): Entity | null {
  return command.targetId === undefined ? null : (ctx.entities.get(command.targetId) ?? null);
}

function capped<T>(values: T[], maxTargets: number | undefined): T[] {
  return maxTargets === undefined ? values : values.slice(0, Math.max(0, maxTargets));
}

function commandAura(
  command: EquipmentEffectCommand,
  name: string,
  kind: Aura['kind'],
  value: number,
): Aura {
  return {
    id: `equipment_${command.sourcePowerId}_${command.kind}`,
    name,
    kind,
    value,
    remaining: durationSeconds(command),
    duration: durationSeconds(command),
    sourceId: command.sourceActorId,
    school: schoolFor(command.tag),
    equipmentProcDepth: command.procDepth,
  };
}

function executeCommand(
  ctx: SimContext,
  actor: Entity,
  event: EquipmentEffectTriggerEvent,
  command: EquipmentEffectCommand,
): void {
  const definition =
    PROCEDURAL_LEGENDARY_POWERS[command.sourcePowerId as keyof typeof PROCEDURAL_LEGENDARY_POWERS];
  if (!definition || definition.revision !== command.sourcePowerRevision) return;
  const name = definition.name;
  const target = commandTarget(ctx, command);
  const school = schoolFor(command.tag);

  switch (command.kind) {
    case 'apply_dot': {
      if (!target || target.dead) return;
      const interval = Math.max(0.05, (command.intervalMs ?? command.durationMs ?? 1000) / 1000);
      const ticks = Math.max(1, Math.ceil(durationSeconds(command) / interval));
      const aura = commandAura(
        command,
        name,
        'dot',
        Math.max(1, Math.round(scaledAmount(actor, event, command) / ticks)),
      );
      aura.tickInterval = interval;
      aura.tickTimer = interval;
      ctx.applyAura(target, aura);
      return;
    }
    case 'apply_mark':
      if (target && !target.dead) {
        ctx.applyAura(target, commandAura(command, name, 'vuln_source', command.magnitude ?? 0));
      }
      return;
    case 'apply_silence':
      if (target && !target.dead) {
        const requested =
          command.magnitude === undefined
            ? durationSeconds(command)
            : Math.max(0.05, command.magnitude / 1000);
        const duration = ctx.diminishedCrowdControlDuration(actor, target, 'lockout', requested);
        if (duration === null) return;
        const aura = commandAura(command, name, 'silence', 1);
        aura.remaining = duration;
        aura.duration = duration;
        ctx.applyAura(target, aura);
      }
      return;
    case 'area_damage': {
      const center = target?.pos ?? actor.pos;
      const victims = ctx
        .hostilesInRadius(actor, center, command.radius ?? 5)
        .filter((entry) => entry.hp > 0 && ctx.hasLineOfSight(actor, entry))
        .sort((a, b) => {
          if (a.id === target?.id) return b.id === target.id ? 0 : -1;
          if (b.id === target?.id) return 1;
          const aDist = (a.pos.x - center.x) ** 2 + (a.pos.z - center.z) ** 2;
          const bDist = (b.pos.x - center.x) ** 2 + (b.pos.z - center.z) ** 2;
          return aDist - bDist || a.id - b.id;
        });
      for (const victim of capped(victims, command.maxTargets)) {
        ctx.dealDamage(
          actor,
          victim,
          scaledAmount(actor, event, command),
          false,
          school,
          name,
          'hit',
          true,
          undefined,
          false,
          false,
          true,
          command.sourcePowerId,
          true,
          command.procDepth,
        );
      }
      return;
    }
    case 'area_heal': {
      const center = target?.pos ?? actor.pos;
      const allies = ctx
        .friendliesInRadius(actor, center, command.radius ?? 5)
        .filter(
          (ally) =>
            !ally.dead && ally.hp > 0 && ally.hp < ally.maxHp && ctx.hasLineOfSight(actor, ally),
        )
        .sort((a, b) => {
          if (a.id === target?.id) return b.id === target.id ? 0 : -1;
          if (b.id === target?.id) return 1;
          const healthOrder = a.hp / a.maxHp - b.hp / b.maxHp;
          if (healthOrder !== 0) return healthOrder;
          const aDist = (a.pos.x - center.x) ** 2 + (a.pos.z - center.z) ** 2;
          const bDist = (b.pos.x - center.x) ** 2 + (b.pos.z - center.z) ** 2;
          return aDist - bDist || a.id - b.id;
        });
      for (const ally of capped(allies, command.maxTargets)) {
        ctx.applyHeal(
          actor,
          ally,
          scaledAmount(actor, event, command),
          name,
          command.sourcePowerId,
          false,
          false,
          command.procDepth,
        );
      }
      return;
    }
    case 'chain_damage': {
      if (!target) return;
      const victims = ctx
        .hostilesInRadius(actor, target.pos, command.radius ?? 8)
        .filter(
          (victim) => victim.id !== target.id && victim.hp > 0 && ctx.hasLineOfSight(actor, victim),
        )
        .sort((a, b) => {
          const aDist = (a.pos.x - target.pos.x) ** 2 + (a.pos.z - target.pos.z) ** 2;
          const bDist = (b.pos.x - target.pos.x) ** 2 + (b.pos.z - target.pos.z) ** 2;
          return aDist - bDist || a.id - b.id;
        });
      for (const victim of capped(victims, command.maxTargets)) {
        ctx.dealDamage(
          actor,
          victim,
          scaledAmount(actor, event, command),
          false,
          school,
          name,
          'hit',
          true,
          undefined,
          false,
          false,
          false,
          command.sourcePowerId,
          false,
          command.procDepth,
        );
      }
      return;
    }
    case 'create_ground_area': {
      const center = target?.pos ?? actor.pos;
      const interval = Math.max(0.05, (command.intervalMs ?? 1000) / 1000);
      const effect: GroundAoE = {
        sourceId: actor.id,
        pos: { ...center },
        radius: command.radius ?? 4,
        min: command.tag === 'healing' ? 0 : scaledAmount(actor, event, command),
        max: command.tag === 'healing' ? 0 : scaledAmount(actor, event, command),
        remaining: durationSeconds(command),
        interval,
        tickTimer: interval,
        school,
        ability: name,
        equipmentPowerId: command.sourcePowerId,
        equipmentProcDepth: command.procDepth,
        ...(command.tag === 'healing' && {
          equipmentAllyHeal: {
            amount: scaledAmount(actor, event, command),
            maxTargets: command.maxTargets,
            primaryTargetId: target?.id,
            powerId: command.sourcePowerId,
            procDepth: command.procDepth,
          },
        }),
      };
      ctx.groundAoEs.push(effect);
      return;
    }
    case 'grant_buff': {
      const recipient = target ?? actor;
      if (recipient.dead) return;
      const magnitude = command.magnitude ?? 0;
      const kind: Aura['kind'] =
        command.tag === 'haste'
          ? 'buff_haste'
          : command.tag === 'movement_speed'
            ? 'buff_speed'
            : command.tag === 'damage_reduction'
              ? 'shield_wall'
              : 'buff_dmg_done';
      const value = kind === 'buff_haste' || kind === 'buff_speed' ? 1 + magnitude : magnitude;
      ctx.applyAura(recipient, commandAura(command, name, kind, value));
      return;
    }
    case 'grant_shield': {
      const recipient = target ?? actor;
      if (!recipient.dead) {
        ctx.applyAura(
          recipient,
          commandAura(command, name, 'absorb', scaledAmount(actor, event, command)),
        );
      }
      return;
    }
    case 'restore_resource': {
      const recipient = target ?? actor;
      recipient.resource = Math.min(
        recipient.maxResource,
        recipient.resource + Math.max(0, command.magnitude ?? 0),
      );
      return;
    }
  }
}

export class EquipmentEffectsController {
  private readonly runtime: EquipmentEffectRuntime;
  private readonly active = new Map<number, ActiveEquipmentPower | null>();
  // Damage fans out once per victim, but Bell cadence is per damaging cast.
  // One player cannot complete the same ability twice in one sim tick, so this
  // authoritative tick+ability key collapses AoE victims without client input.
  private readonly lastSpellDamageCast = new Map<number, { tick: number; abilityId: string }>();

  constructor(random: () => number) {
    this.runtime = new EquipmentEffectRuntime(PROCEDURAL_LEGENDARY_POWERS, random);
  }

  refresh(ctx: SimContext, actorId: number): void {
    // Refresh only changes which power is active. Runtime state is keyed by actor
    // and power, so retaining it prevents gear swaps from resetting cadence or an
    // internal cooldown. Death and actor removal still clear all tracked state.
    const meta = ctx.players.get(actorId);
    this.active.set(actorId, meta ? activePowerFor(meta) : null);
  }

  clearActor(actorId: number, remove = false): void {
    this.runtime.clearActor(actorId);
    this.lastSpellDamageCast.delete(actorId);
    if (remove) this.active.delete(actorId);
  }

  trigger(ctx: SimContext, actor: Entity, event: EquipmentEffectTriggerEvent): void {
    if (actor.kind !== 'player' || actor.dead) return;
    const meta = ctx.players.get(actor.id);
    if (!meta) return;
    if (event.kind === 'spell_damage') {
      const abilityId = event.abilityId ?? '';
      const previous = this.lastSpellDamageCast.get(actor.id);
      if (previous?.tick === ctx.tickCount && previous.abilityId === abilityId) return;
      this.lastSpellDamageCast.set(actor.id, { tick: ctx.tickCount, abilityId });
    }
    const active = this.active.get(actor.id) ?? null;
    const evaluation = this.runtime.evaluate(active, {
      ...event,
      nowMs: Math.round(ctx.time * 1000),
      actorId: actor.id,
      actorClass: meta.cls,
    });
    for (const command of evaluation.commands) executeCommand(ctx, actor, event, command);
  }
}
