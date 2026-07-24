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
        const aura = commandAura(command, name, 'silence', 1);
        if (command.magnitude !== undefined) {
          aura.remaining = Math.max(0.05, command.magnitude / 1000);
          aura.duration = aura.remaining;
        }
        ctx.applyAura(target, aura);
      }
      return;
    case 'area_damage': {
      const center = target?.pos ?? actor.pos;
      for (const victim of capped(
        ctx.hostilesInRadius(actor, center, command.radius ?? 5).filter((entry) => entry.hp > 0),
        command.maxTargets,
      )) {
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
          true,
          command.procDepth,
        );
      }
      return;
    }
    case 'area_heal': {
      const center = target?.pos ?? actor.pos;
      for (const ally of capped(
        ctx.friendliesInRadius(actor, center, command.radius ?? 5),
        command.maxTargets,
      )) {
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
        .filter((victim) => victim.id !== target.id && victim.hp > 0);
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

  constructor(random: () => number) {
    this.runtime = new EquipmentEffectRuntime(PROCEDURAL_LEGENDARY_POWERS, random);
  }

  refresh(ctx: SimContext, actorId: number): void {
    this.runtime.clearActor(actorId);
    const meta = ctx.players.get(actorId);
    this.active.set(actorId, meta ? activePowerFor(meta) : null);
  }

  clearActor(actorId: number, remove = false): void {
    this.runtime.clearActor(actorId);
    if (remove) this.active.delete(actorId);
  }

  trigger(ctx: SimContext, actor: Entity, event: EquipmentEffectTriggerEvent): void {
    if (actor.kind !== 'player' || actor.dead) return;
    const meta = ctx.players.get(actor.id);
    if (!meta) return;
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
