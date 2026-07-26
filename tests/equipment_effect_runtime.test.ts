import { describe, expect, it, vi } from 'vitest';
import { PROCEDURAL_LEGENDARY_POWERS } from '../src/sim/content/procedural_legendary_powers';
import {
  EquipmentEffectRuntime,
  selectActiveEquipmentPower,
} from '../src/sim/equipment/equipment_effect_runtime';
import {
  type ActiveEquipmentPower,
  type EquipmentEffectEvent,
  type EquipmentPowerDefinition,
  MAX_EQUIPMENT_PROC_DEPTH,
} from '../src/sim/equipment/equipment_effect_types';
import type { PlayerClass } from '../src/sim/types';

const POWER_DEFINITIONS: readonly EquipmentPowerDefinition[] = Object.values(
  PROCEDURAL_LEGENDARY_POWERS,
);

function activePower(definition: EquipmentPowerDefinition): ActiveEquipmentPower {
  return {
    powerId: definition.id,
    powerRevision: definition.revision,
    itemLevel: 20,
    rolls: Object.fromEntries(
      Object.entries(definition.rolls).map(([key, roll]) => [key, (roll.min + roll.max) / 2]),
    ),
  };
}

function matchingEvent(
  definition: EquipmentPowerDefinition,
  overrides: Partial<EquipmentEffectEvent> = {},
): EquipmentEffectEvent {
  return {
    kind: definition.trigger.event,
    nowMs: 10_000,
    actorId: 1,
    actorClass: definition.requiredClass ?? 'mage',
    targetId: 2,
    abilityId: definition.trigger.abilityIds?.[0],
    critical: true,
    amount: 100,
    healthBefore: 400,
    healthAfter: 300,
    maxHealth: 1000,
    movementDistance: definition.trigger.accumulatedMovement,
    ...overrides,
  };
}

function triggerPower(
  runtime: EquipmentEffectRuntime,
  definition: EquipmentPowerDefinition,
  event = matchingEvent(definition),
) {
  let result = runtime.evaluate(activePower(definition), event);
  const every = definition.trigger.every ?? 1;
  for (let count = 1; count < every; count += 1) {
    result = runtime.evaluate(activePower(definition), {
      ...event,
      nowMs: event.nowMs + count,
    });
  }
  return result;
}

describe('equipment power selection', () => {
  it('selects no active power from ordinary equipment', () => {
    expect(
      selectActiveEquipmentPower([
        { slot: 'head', uid: 'a' },
        { slot: 'chest', uid: 'b' },
      ]),
    ).toEqual({ status: 'none' });
  });

  it('selects the exact UID, slot, and power for one legendary', () => {
    expect(
      selectActiveEquipmentPower([
        { slot: 'head', uid: 'pi1:test:1', powerId: 'crown_last_pyre' },
        { slot: 'chest', uid: 'pi1:test:2' },
      ]),
    ).toEqual({
      status: 'active',
      powerId: 'crown_last_pyre',
      uid: 'pi1:test:1',
      slot: 'head',
    });
  });

  it('rejects two active powers instead of choosing one silently', () => {
    expect(
      selectActiveEquipmentPower([
        { slot: 'head', uid: 'a', powerId: 'crown_last_pyre' },
        { slot: 'feet', uid: 'b', powerId: 'boots_of_the_unbroken_road' },
      ]),
    ).toEqual({
      status: 'invalid',
      reason: 'multiple_active_powers',
      powerIds: ['crown_last_pyre', 'boots_of_the_unbroken_road'],
    });
  });
});

describe('equipment effect runtime safety', () => {
  it('takes the no-power fast path without creating tracked state or using RNG', () => {
    const random = vi.fn(() => 0);
    const runtime = new EquipmentEffectRuntime(PROCEDURAL_LEGENDARY_POWERS, random);
    const result = runtime.evaluate(
      null,
      matchingEvent(PROCEDURAL_LEGENDARY_POWERS.crown_last_pyre),
    );
    expect(result).toEqual({ triggered: false, reason: 'no_power', commands: [] });
    expect(runtime.trackedStateCount()).toBe(0);
    expect(random).not.toHaveBeenCalled();
  });

  it('rejects unknown powers', () => {
    const runtime = new EquipmentEffectRuntime(PROCEDURAL_LEGENDARY_POWERS, () => 0);
    const result = runtime.evaluate(
      { powerId: 'unknown', powerRevision: 1, itemLevel: 20, rolls: {} },
      matchingEvent(PROCEDURAL_LEGENDARY_POWERS.crown_last_pyre),
    );
    expect(result.reason).toBe('unknown_power');
  });

  it('rejects revision mismatches', () => {
    const runtime = new EquipmentEffectRuntime(PROCEDURAL_LEGENDARY_POWERS, () => 0);
    const power = activePower(PROCEDURAL_LEGENDARY_POWERS.crown_last_pyre);
    const result = runtime.evaluate(
      { ...power, powerRevision: 2 as 1 },
      matchingEvent(PROCEDURAL_LEGENDARY_POWERS.crown_last_pyre),
    );
    expect(result.reason).toBe('revision_mismatch');
  });

  it('enforces required classes', () => {
    const runtime = new EquipmentEffectRuntime(PROCEDURAL_LEGENDARY_POWERS, () => 0);
    const definition = PROCEDURAL_LEGENDARY_POWERS.crown_last_pyre;
    const result = runtime.evaluate(
      activePower(definition),
      matchingEvent(definition, { actorClass: 'warrior' }),
    );
    expect(result.reason).toBe('class_mismatch');
  });

  it('enforces event kinds and ability allowlists', () => {
    const runtime = new EquipmentEffectRuntime(PROCEDURAL_LEGENDARY_POWERS, () => 0);
    const definition = PROCEDURAL_LEGENDARY_POWERS.crown_last_pyre;
    expect(
      runtime.evaluate(activePower(definition), matchingEvent(definition, { kind: 'heal' })).reason,
    ).toBe('event_mismatch');
    expect(
      runtime.evaluate(
        activePower(definition),
        matchingEvent(definition, { abilityId: 'frostbolt' }),
      ).reason,
    ).toBe('ability_mismatch');
  });

  it('enforces critical-only triggers', () => {
    const runtime = new EquipmentEffectRuntime(PROCEDURAL_LEGENDARY_POWERS, () => 0);
    const definition = PROCEDURAL_LEGENDARY_POWERS.ysoleis_vigil;
    const result = runtime.evaluate(
      activePower(definition),
      matchingEvent(definition, { critical: false }),
    );
    expect(result.reason).toBe('critical_required');
  });

  it('requires an actual threshold crossing', () => {
    const runtime = new EquipmentEffectRuntime(PROCEDURAL_LEGENDARY_POWERS, () => 0);
    const definition = PROCEDURAL_LEGENDARY_POWERS.mantle_of_borrowed_time;
    const power = activePower(definition);
    expect(
      runtime.evaluate(power, matchingEvent(definition, { healthBefore: 340, healthAfter: 300 }))
        .reason,
    ).toBe('health_crossing_mismatch');
    expect(
      runtime.evaluate(power, matchingEvent(definition, { healthBefore: 400, healthAfter: 350 }))
        .triggered,
    ).toBe(true);
  });

  it('caps recursive equipment procs at depth four', () => {
    const runtime = new EquipmentEffectRuntime(PROCEDURAL_LEGENDARY_POWERS, () => 0);
    const definition = PROCEDURAL_LEGENDARY_POWERS.greyjaws_edge;
    const result = runtime.evaluate(
      activePower(definition),
      matchingEvent(definition, { procDepth: MAX_EQUIPMENT_PROC_DEPTH }),
    );
    expect(result.reason).toBe('proc_depth_limit');
    expect(result.commands).toEqual([]);
  });

  it('does not consume RNG while an internal cooldown is active', () => {
    const random = vi.fn(() => 0);
    const runtime = new EquipmentEffectRuntime(PROCEDURAL_LEGENDARY_POWERS, random);
    const definition = PROCEDURAL_LEGENDARY_POWERS.hushwood_longbow;
    const power = activePower(definition);
    expect(runtime.evaluate(power, matchingEvent(definition)).triggered).toBe(true);
    expect(runtime.evaluate(power, matchingEvent(definition, { nowMs: 10_001 })).reason).toBe(
      'internal_cooldown',
    );
    expect(random).toHaveBeenCalledTimes(1);
  });

  it('fails closed for invalid RNG output', () => {
    const runtime = new EquipmentEffectRuntime(PROCEDURAL_LEGENDARY_POWERS, () => 1);
    const definition = PROCEDURAL_LEGENDARY_POWERS.hushwood_longbow;
    expect(() => runtime.evaluate(activePower(definition), matchingEvent(definition))).toThrow(
      'invalid value 1',
    );
  });

  it('records failed chance rolls without starting the cooldown', () => {
    const rolls = [0.9, 0.1];
    const runtime = new EquipmentEffectRuntime(
      PROCEDURAL_LEGENDARY_POWERS,
      () => rolls.shift() ?? 0,
    );
    const definition = PROCEDURAL_LEGENDARY_POWERS.hushwood_longbow;
    const power = activePower(definition);
    expect(runtime.evaluate(power, matchingEvent(definition)).reason).toBe('chance_failed');
    expect(runtime.evaluate(power, matchingEvent(definition, { nowMs: 10_001 })).triggered).toBe(
      true,
    );
  });

  it('clears only the requested actor state', () => {
    const runtime = new EquipmentEffectRuntime(PROCEDURAL_LEGENDARY_POWERS, () => 0);
    const definition = PROCEDURAL_LEGENDARY_POWERS.crown_last_pyre;
    runtime.evaluate(activePower(definition), matchingEvent(definition, { actorId: 1 }));
    runtime.evaluate(activePower(definition), matchingEvent(definition, { actorId: 2 }));
    expect(runtime.trackedStateCount()).toBe(2);
    runtime.clearActor(1);
    expect(runtime.trackedStateCount()).toBe(1);
  });
});

describe('equipment effect cadence and command projection', () => {
  it('fires exactly on every third eligible cast', () => {
    const runtime = new EquipmentEffectRuntime(PROCEDURAL_LEGENDARY_POWERS, () => 0);
    const definition = PROCEDURAL_LEGENDARY_POWERS.crown_last_pyre;
    const event = matchingEvent(definition);
    expect(runtime.evaluate(activePower(definition), event).reason).toBe('cadence_pending');
    expect(runtime.evaluate(activePower(definition), { ...event, nowMs: 10_001 }).reason).toBe(
      'cadence_pending',
    );
    expect(runtime.evaluate(activePower(definition), { ...event, nowMs: 10_002 }).triggered).toBe(
      true,
    );
  });

  it('accumulates movement and preserves overflow', () => {
    const runtime = new EquipmentEffectRuntime(PROCEDURAL_LEGENDARY_POWERS, () => 0);
    const definition = PROCEDURAL_LEGENDARY_POWERS.boots_of_the_unbroken_road;
    const power = activePower(definition);
    expect(
      runtime.evaluate(power, matchingEvent(definition, { movementDistance: 10, nowMs: 0 })).reason,
    ).toBe('movement_pending');
    expect(
      runtime.evaluate(power, matchingEvent(definition, { movementDistance: 7, nowMs: 1 }))
        .triggered,
    ).toBe(true);
    expect(
      runtime.evaluate(power, matchingEvent(definition, { movementDistance: 13, nowMs: 6001 }))
        .triggered,
    ).toBe(true);
  });

  it('projects resolved roll values and increments proc depth', () => {
    const runtime = new EquipmentEffectRuntime(PROCEDURAL_LEGENDARY_POWERS, () => 0);
    const definition = PROCEDURAL_LEGENDARY_POWERS.greyjaws_edge;
    const power = {
      ...activePower(definition),
      rolls: { potencyPct: 38 },
    };
    const event = matchingEvent(definition, { procDepth: 2, actorId: 7, targetId: 9 });
    runtime.evaluate(power, event);
    runtime.evaluate(power, { ...event, nowMs: event.nowMs + 1 });
    const result = runtime.evaluate(power, { ...event, nowMs: event.nowMs + 2 });
    expect(result.triggered).toBe(true);
    expect(result.commands).toHaveLength(2);
    expect(result.commands[0]).toMatchObject({
      kind: 'apply_dot',
      sourcePowerId: 'greyjaws_edge',
      sourceActorId: 7,
      targetId: 9,
      magnitude: 0.38,
      procDepth: 3,
    });
    expect(result.commands[1]).toMatchObject({
      kind: 'restore_resource',
      targetId: 7,
      magnitude: 4,
    });
  });

  it('applies authored class magnitude multipliers only to the matching class', () => {
    const definition = PROCEDURAL_LEGENDARY_POWERS.bell_of_the_ninth_peal;
    const mageRuntime = new EquipmentEffectRuntime(PROCEDURAL_LEGENDARY_POWERS, () => 0);
    const paladinRuntime = new EquipmentEffectRuntime(PROCEDURAL_LEGENDARY_POWERS, () => 0);

    const mage = triggerPower(
      mageRuntime,
      definition,
      matchingEvent(definition, { actorClass: 'mage' }),
    );
    const paladin = triggerPower(
      paladinRuntime,
      definition,
      matchingEvent(definition, { actorClass: 'paladin' }),
    );

    expect(mage.commands[0]?.magnitude).toBe(0.27);
    expect(paladin.commands[0]?.magnitude).toBeCloseTo(0.594);
  });

  it('fails closed on an invalid authored class magnitude multiplier', () => {
    const definition: EquipmentPowerDefinition = {
      ...PROCEDURAL_LEGENDARY_POWERS.bell_of_the_ninth_peal,
      id: 'invalid_class_multiplier',
      effects: [
        {
          ...PROCEDURAL_LEGENDARY_POWERS.bell_of_the_ninth_peal.effects[0],
          magnitude: {
            rollKey: 'potencyPct',
            rollScale: 0.01,
            classMultipliers: { paladin: Number.NaN },
          },
        },
      ],
    };
    const runtime = new EquipmentEffectRuntime({ [definition.id]: definition }, () => 0);

    expect(() =>
      triggerPower(runtime, definition, matchingEvent(definition, { actorClass: 'paladin' })),
    ).toThrow('invalid paladin magnitude multiplier');
  });

  it('throws when a persisted roll required by an effect is absent', () => {
    const runtime = new EquipmentEffectRuntime(PROCEDURAL_LEGENDARY_POWERS, () => 0);
    const definition = PROCEDURAL_LEGENDARY_POWERS.greyjaws_edge;
    const power = { ...activePower(definition), rolls: {} };
    const event = matchingEvent(definition);
    runtime.evaluate(power, event);
    runtime.evaluate(power, { ...event, nowMs: event.nowMs + 1 });
    expect(() => runtime.evaluate(power, { ...event, nowMs: event.nowMs + 2 })).toThrow(
      'missing finite roll potencyPct',
    );
  });
});

describe.each(Object.values(PROCEDURAL_LEGENDARY_POWERS))('$id runtime contract', (definition) => {
  it('can trigger from a matching, deterministic event', () => {
    const runtime = new EquipmentEffectRuntime(PROCEDURAL_LEGENDARY_POWERS, () => 0);
    const result = triggerPower(runtime, definition);
    expect(result.triggered).toBe(true);
    expect(result.reason).toBe('triggered');
    expect(result.commands).toHaveLength(definition.effects.length);
  });

  it('emits only commands attributed to this versioned power', () => {
    const runtime = new EquipmentEffectRuntime(PROCEDURAL_LEGENDARY_POWERS, () => 0);
    const result = triggerPower(runtime, definition);
    for (const command of result.commands) {
      expect(command.sourcePowerId).toBe(definition.id);
      expect(command.sourcePowerRevision).toBe(1);
      expect(command.procDepth).toBe(1);
    }
  });

  it('keeps commands finite and bounded', () => {
    const runtime = new EquipmentEffectRuntime(PROCEDURAL_LEGENDARY_POWERS, () => 0);
    const result = triggerPower(runtime, definition);
    for (const command of result.commands) {
      if (command.magnitude !== undefined) expect(Number.isFinite(command.magnitude)).toBe(true);
      expect(command.durationMs ?? 0).toBeGreaterThanOrEqual(0);
      expect(command.radius ?? 0).toBeGreaterThanOrEqual(0);
      expect(command.maxTargets ?? 0).toBeGreaterThanOrEqual(0);
    }
  });
});

describe.each([
  'warrior',
  'paladin',
  'hunter',
  'rogue',
  'priest',
  'shaman',
  'mage',
  'warlock',
  'druid',
] satisfies PlayerClass[])('%s class isolation', (actorClass) => {
  it('cannot activate a legendary assigned to a different class', () => {
    const other = POWER_DEFINITIONS.find(
      (power) => power.requiredClass !== undefined && power.requiredClass !== actorClass,
    );
    if (!other) throw new Error('Expected a power assigned to another class');
    const runtime = new EquipmentEffectRuntime(PROCEDURAL_LEGENDARY_POWERS, () => 0);
    expect(runtime.evaluate(activePower(other), matchingEvent(other, { actorClass })).reason).toBe(
      'class_mismatch',
    );
  });
});
