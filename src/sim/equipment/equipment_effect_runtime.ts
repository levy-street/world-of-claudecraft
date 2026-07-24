import {
  type ActiveEquipmentPower,
  type ActiveEquipmentPowerSelection,
  type EquipmentEffectCommand,
  type EquipmentEffectEvaluation,
  type EquipmentEffectEvent,
  type EquipmentPowerDefinition,
  type EquipmentPowerMagnitude,
  type EquippedPowerCandidate,
  MAX_EQUIPMENT_PROC_DEPTH,
} from './equipment_effect_types';

interface PowerRuntimeState {
  eligibleEvents: number;
  accumulatedMovement: number;
  readyAtMs: number;
}

export type EquipmentPowerCatalogue = Readonly<Record<string, EquipmentPowerDefinition>>;
export type EquipmentPowerRandom = () => number;

const EMPTY_COMMANDS: EquipmentEffectCommand[] = [];

function noTrigger(reason: EquipmentEffectEvaluation['reason']): EquipmentEffectEvaluation {
  return { triggered: false, reason, commands: EMPTY_COMMANDS };
}

function finiteOrZero(value: number | undefined): number {
  return value === undefined || !Number.isFinite(value) ? 0 : value;
}

function resolveMagnitude(
  magnitude: EquipmentPowerMagnitude | undefined,
  power: ActiveEquipmentPower,
): number | undefined {
  if (!magnitude) return undefined;

  let value = finiteOrZero(magnitude.base);
  value += finiteOrZero(magnitude.itemLevelScale) * power.itemLevel;
  if (magnitude.rollKey) {
    const roll = power.rolls[magnitude.rollKey];
    if (roll === undefined || !Number.isFinite(roll)) {
      throw new Error(
        `Equipment power ${power.powerId} is missing finite roll ${magnitude.rollKey}`,
      );
    }
    value += roll * (magnitude.rollScale ?? 1);
  }
  if (magnitude.minimum !== undefined) value = Math.max(value, magnitude.minimum);
  if (magnitude.maximum !== undefined) value = Math.min(value, magnitude.maximum);
  return value;
}

function crossedHealthThreshold(
  event: EquipmentEffectEvent,
  definition: EquipmentPowerDefinition,
): boolean {
  const crossing = definition.trigger.healthCrossing;
  if (!crossing) return true;
  if (
    event.healthBefore === undefined ||
    event.healthAfter === undefined ||
    event.maxHealth === undefined ||
    event.maxHealth <= 0
  ) {
    return false;
  }

  const before = event.healthBefore / event.maxHealth;
  const after = event.healthAfter / event.maxHealth;
  return crossing.direction === 'below'
    ? before > crossing.fraction && after <= crossing.fraction
    : before < crossing.fraction && after >= crossing.fraction;
}

function targetIdFor(
  target: EquipmentEffectCommand['target'],
  event: EquipmentEffectEvent,
): number | undefined {
  return target === 'self' || target === 'area_around_self' ? event.actorId : event.targetId;
}

export function selectActiveEquipmentPower(
  candidates: readonly EquippedPowerCandidate[],
): ActiveEquipmentPowerSelection {
  const active = candidates.filter(
    (candidate): candidate is EquippedPowerCandidate & { powerId: string } =>
      candidate.powerId !== undefined,
  );
  if (active.length === 0) return { status: 'none' };
  if (active.length > 1) {
    return {
      status: 'invalid',
      reason: 'multiple_active_powers',
      powerIds: active.map((candidate) => candidate.powerId),
    };
  }
  const only = active[0];
  return {
    status: 'active',
    powerId: only.powerId,
    uid: only.uid,
    slot: only.slot,
  };
}

export class EquipmentEffectRuntime {
  private readonly state = new Map<string, PowerRuntimeState>();

  constructor(
    private readonly catalogue: EquipmentPowerCatalogue,
    private readonly random: EquipmentPowerRandom,
  ) {}

  evaluate(
    power: ActiveEquipmentPower | null,
    event: EquipmentEffectEvent,
  ): EquipmentEffectEvaluation {
    if (!power) return noTrigger('no_power');

    const definition = this.catalogue[power.powerId];
    if (!definition) return noTrigger('unknown_power');
    if (power.powerRevision !== definition.revision) return noTrigger('revision_mismatch');
    if (definition.requiredClass && definition.requiredClass !== event.actorClass) {
      return noTrigger('class_mismatch');
    }
    if (definition.trigger.event !== event.kind) return noTrigger('event_mismatch');
    if (
      definition.trigger.abilityIds &&
      (!event.abilityId || !definition.trigger.abilityIds.includes(event.abilityId))
    ) {
      return noTrigger('ability_mismatch');
    }
    if (definition.trigger.criticalOnly && event.critical !== true) {
      return noTrigger('critical_required');
    }
    if (!crossedHealthThreshold(event, definition)) {
      return noTrigger('health_crossing_mismatch');
    }
    if ((event.procDepth ?? 0) >= MAX_EQUIPMENT_PROC_DEPTH) {
      return noTrigger('proc_depth_limit');
    }

    const key = `${event.actorId}:${power.powerId}`;
    const state = this.state.get(key) ?? {
      eligibleEvents: 0,
      accumulatedMovement: 0,
      readyAtMs: 0,
    };
    if (event.nowMs < state.readyAtMs) return noTrigger('internal_cooldown');

    state.eligibleEvents += 1;
    const every = definition.trigger.every ?? 1;
    if (state.eligibleEvents % every !== 0) {
      this.state.set(key, state);
      return noTrigger('cadence_pending');
    }

    if (definition.trigger.accumulatedMovement !== undefined) {
      state.accumulatedMovement += Math.max(0, event.movementDistance ?? 0);
      if (state.accumulatedMovement < definition.trigger.accumulatedMovement) {
        this.state.set(key, state);
        return noTrigger('movement_pending');
      }
      state.accumulatedMovement -= definition.trigger.accumulatedMovement;
    }

    const chance = definition.trigger.chance ?? 1;
    if (chance < 1) {
      const roll = this.random();
      if (!Number.isFinite(roll) || roll < 0 || roll >= 1) {
        throw new Error(`Equipment power RNG returned invalid value ${roll}`);
      }
      if (roll >= chance) {
        this.state.set(key, state);
        return noTrigger('chance_failed');
      }
    }

    state.readyAtMs = event.nowMs + (definition.trigger.internalCooldownMs ?? 0);
    this.state.set(key, state);
    const commands = definition.effects.map<EquipmentEffectCommand>((effect) => ({
      kind: effect.kind,
      sourcePowerId: definition.id,
      sourcePowerRevision: definition.revision,
      sourceActorId: event.actorId,
      targetId: targetIdFor(effect.target, event),
      target: effect.target,
      magnitude: resolveMagnitude(effect.magnitude, power),
      durationMs: effect.durationMs,
      intervalMs: effect.intervalMs,
      radius: effect.radius,
      maxTargets: effect.maxTargets,
      tag: effect.tag,
      procDepth: (event.procDepth ?? 0) + 1,
    }));
    return { triggered: true, reason: 'triggered', commands };
  }

  clearActor(actorId: number): void {
    const prefix = `${actorId}:`;
    for (const key of this.state.keys()) {
      if (key.startsWith(prefix)) this.state.delete(key);
    }
  }

  trackedStateCount(): number {
    return this.state.size;
  }
}
