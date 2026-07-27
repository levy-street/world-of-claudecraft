import { describe, expect, it } from 'vitest';
import { PROCEDURAL_LEGENDARY_POWERS } from '../src/sim/content/procedural_legendary_powers';
import { EquipmentEffectRuntime } from '../src/sim/equipment/equipment_effect_runtime';
import type {
  ActiveEquipmentPower,
  EquipmentEffectCommand,
  EquipmentEffectEvent,
  EquipmentPowerDefinition,
} from '../src/sim/equipment/equipment_effect_types';

interface PropertyCase {
  definition: EquipmentPowerDefinition;
  seed: number;
}

interface SequenceResult {
  triggers: number;
  commands: EquipmentEffectCommand[];
  reasons: Record<string, number>;
}

function randomFromSeed(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4_294_967_296;
  };
}

function activePower(definition: EquipmentPowerDefinition, seed: number): ActiveEquipmentPower {
  const random = randomFromSeed(seed ^ 0x9e3779b9);
  return {
    powerId: definition.id,
    powerRevision: definition.revision,
    itemLevel: 1 + Math.floor(random() * 60),
    rolls: Object.fromEntries(
      Object.entries(definition.rolls).map(([key, roll]) => {
        const steps = Math.floor((roll.max - roll.min) / roll.step);
        return [key, roll.min + Math.floor(random() * (steps + 1)) * roll.step];
      }),
    ),
  };
}

function eventFor(definition: EquipmentPowerDefinition, index: number): EquipmentEffectEvent {
  const crossing = definition.trigger.healthCrossing;
  return {
    kind: definition.trigger.event,
    nowMs: index * 1000,
    actorId: 100,
    actorClass: definition.requiredClass ?? 'mage',
    targetId: 200,
    abilityId: definition.trigger.abilityIds?.[0],
    critical: true,
    amount: 100,
    healthBefore: crossing?.direction === 'above' ? 300 : 700,
    healthAfter: crossing?.direction === 'above' ? 700 : 300,
    maxHealth: 1000,
    movementDistance: 1 + (index % 7),
    procDepth: index % 4,
  };
}

function runSequence(definition: EquipmentPowerDefinition, seed: number): SequenceResult {
  const runtime = new EquipmentEffectRuntime(PROCEDURAL_LEGENDARY_POWERS, randomFromSeed(seed));
  const power = activePower(definition, seed);
  const reasons: Record<string, number> = {};
  const commands: EquipmentEffectCommand[] = [];
  let triggers = 0;
  for (let index = 0; index < 240; index += 1) {
    const result = runtime.evaluate(power, eventFor(definition, index));
    reasons[result.reason] = (reasons[result.reason] ?? 0) + 1;
    if (result.triggered) triggers += 1;
    commands.push(...result.commands);
  }
  return { triggers, commands, reasons };
}

const POWER_DEFINITIONS = Object.values(PROCEDURAL_LEGENDARY_POWERS) as EquipmentPowerDefinition[];

const PROPERTY_CASES: PropertyCase[] = POWER_DEFINITIONS.flatMap((definition, powerIndex) =>
  Array.from({ length: 20 }, (_, seedIndex) => ({
    definition,
    seed: 1 + powerIndex * 1000 + seedIndex * 7919,
  })),
);

describe.each(PROPERTY_CASES)('$definition.id property seed $seed', ({ definition, seed }) => {
  it('replays the same event stream byte for byte', () => {
    expect(runSequence(definition, seed)).toEqual(runSequence(definition, seed));
  });

  it('emits only bounded and finite commands', () => {
    const result = runSequence(definition, seed);
    expect(result.triggers).toBeGreaterThan(0);
    expect(result.commands.length).toBe(result.triggers * definition.effects.length);
    for (const command of result.commands) {
      expect(command.sourcePowerId).toBe(definition.id);
      expect(command.sourcePowerRevision).toBe(1);
      expect(command.sourceActorId).toBe(100);
      expect(command.targetId).toBeGreaterThan(0);
      expect(command.procDepth).toBeGreaterThanOrEqual(1);
      expect(command.procDepth).toBeLessThanOrEqual(4);
      if (command.magnitude !== undefined) {
        expect(Number.isFinite(command.magnitude)).toBe(true);
        expect(command.magnitude).toBeGreaterThanOrEqual(0);
        expect(command.magnitude).toBeLessThanOrEqual(2000);
      }
      expect(command.durationMs ?? 0).toBeLessThanOrEqual(60_000);
      expect(command.radius ?? 0).toBeLessThanOrEqual(20);
      expect(command.maxTargets ?? 0).toBeLessThanOrEqual(20);
    }
  });

  it('never exceeds the theoretical trigger ceiling', () => {
    const result = runSequence(definition, seed);
    const depthEligible = 240;
    const cadence = definition.trigger.every ?? 1;
    const cadenceCeiling = Math.ceil(depthEligible / cadence);
    expect(result.triggers).toBeLessThanOrEqual(cadenceCeiling);
    expect(result.triggers).toBeLessThanOrEqual(240);
    expect(Object.values(result.reasons).reduce((sum, count) => sum + count, 0)).toBe(240);
  });
});

describe('equipment effect property matrix coverage', () => {
  it('covers every power with twenty independent seeds', () => {
    expect(PROPERTY_CASES).toHaveLength(240);
    for (const definition of POWER_DEFINITIONS) {
      expect(PROPERTY_CASES.filter((testCase) => testCase.definition === definition)).toHaveLength(
        20,
      );
    }
  });
});
