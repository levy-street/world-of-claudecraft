import { describe, expect, it } from 'vitest';
import { ABILITIES } from '../src/sim/content/classes';
import {
  PROCEDURAL_LEGENDARY_POWER_IDS,
  PROCEDURAL_LEGENDARY_POWERS,
  proceduralLegendaryPower,
  proceduralLegendaryPowerCompatibleWithBase,
} from '../src/sim/content/procedural_legendary_powers';
import { PROCEDURAL_ITEM_BASES } from '../src/sim/content/procedural_loot';
import type { EquipmentPowerDefinition } from '../src/sim/equipment/equipment_effect_types';

const POWER_DEFINITIONS: readonly EquipmentPowerDefinition[] = Object.values(
  PROCEDURAL_LEGENDARY_POWERS,
);

describe('procedural legendary power content', () => {
  it('ships exactly nine class powers and three neutral powers', () => {
    const powers = POWER_DEFINITIONS;
    expect(powers).toHaveLength(12);
    expect(powers.filter((power) => power.requiredClass !== undefined)).toHaveLength(9);
    expect(powers.filter((power) => power.requiredClass === undefined)).toHaveLength(3);
    expect(new Set(PROCEDURAL_LEGENDARY_POWER_IDS).size).toBe(12);
  });

  it('keeps IDs, revisions, text, triggers, effects, and roll schemas complete', () => {
    for (const [id, power] of Object.entries(PROCEDURAL_LEGENDARY_POWERS) as [
      string,
      EquipmentPowerDefinition,
    ][]) {
      expect(power.id).toBe(id);
      expect(power.revision).toBe(1);
      expect(power.name.length).toBeGreaterThan(5);
      expect(power.description.endsWith('.')).toBe(true);
      expect(power.effects.length).toBeGreaterThan(0);
      expect(Object.keys(power.rolls).length).toBeGreaterThan(0);

      for (const roll of Object.values(power.rolls)) {
        expect(Number.isFinite(roll.min)).toBe(true);
        expect(Number.isFinite(roll.max)).toBe(true);
        expect(roll.min).toBeLessThanOrEqual(roll.max);
        expect(roll.step).toBeGreaterThan(0);
      }
      for (const baseId of power.compatibleBaseIds ?? []) {
        expect(
          PROCEDURAL_ITEM_BASES[baseId],
          `${power.id} references missing ${baseId}`,
        ).toBeDefined();
      }
    }
  });

  it('references only real v0.30 ability IDs belonging to the required class', () => {
    for (const power of POWER_DEFINITIONS) {
      for (const abilityId of power.trigger.abilityIds ?? []) {
        const ability = ABILITIES[abilityId];
        expect(ability, `${power.id} references missing ${abilityId}`).toBeDefined();
        expect(ability.id).toBe(abilityId);
        if (power.requiredClass) expect(ability.class).toBe(power.requiredClass);
      }
    }
  });

  it('keeps proc inputs inside production-safe limits', () => {
    for (const power of POWER_DEFINITIONS) {
      const trigger = power.trigger;
      expect(trigger.chance ?? 1).toBeGreaterThan(0);
      expect(trigger.chance ?? 1).toBeLessThanOrEqual(1);
      expect(trigger.every ?? 1).toBeGreaterThanOrEqual(1);
      expect(trigger.internalCooldownMs ?? 0).toBeGreaterThanOrEqual(0);
      if (trigger.healthCrossing) {
        expect(trigger.healthCrossing.fraction).toBeGreaterThan(0);
        expect(trigger.healthCrossing.fraction).toBeLessThan(1);
      }
      if (trigger.accumulatedMovement !== undefined) {
        expect(trigger.accumulatedMovement).toBeGreaterThan(0);
      }

      for (const effect of power.effects) {
        expect(effect.durationMs ?? 0).toBeGreaterThanOrEqual(0);
        expect(effect.intervalMs ?? 0).toBeGreaterThanOrEqual(0);
        expect(effect.radius ?? 0).toBeGreaterThanOrEqual(0);
        expect(effect.maxTargets ?? 0).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('restricts the Bell to caster-class bases instead of issuing dead powers', () => {
    const bell = PROCEDURAL_LEGENDARY_POWERS.bell_of_the_ninth_peal;

    expect(
      proceduralLegendaryPowerCompatibleWithBase(bell, PROCEDURAL_ITEM_BASES.ashwood_staff),
    ).toBe(true);
    expect(
      proceduralLegendaryPowerCompatibleWithBase(bell, PROCEDURAL_ITEM_BASES.gravecaller_focus),
    ).toBe(true);
    expect(
      proceduralLegendaryPowerCompatibleWithBase(bell, PROCEDURAL_ITEM_BASES.gravecaller_ring),
    ).toBe(false);
    expect(
      proceduralLegendaryPowerCompatibleWithBase(bell, PROCEDURAL_ITEM_BASES.iron_broadsword),
    ).toBe(false);
  });

  it('pins every one of the 408 power and base compatibility decisions', () => {
    const expectedByPower = {
      crown_last_pyre: ['gravecaller_cloth_hood'],
      greyjaws_edge: [
        'iron_broadsword',
        'thornpeak_war_axe',
        'iron_flanged_mace',
        'thornpeak_polearm',
      ],
      hushwood_longbow: ['mirefen_hunting_bow'],
      nightglass_fang: ['mirefen_dirk'],
      ysoleis_vigil: ['ashwood_staff', 'gravecaller_focus'],
      stormwake_idol: ['gravecaller_focus'],
      ashbinders_seal: ['gravecaller_ring'],
      dawnward_signet: ['gravecaller_ring'],
      feral_moonclasp: ['gravecaller_pendant'],
      bell_of_the_ninth_peal: ['ashwood_staff', 'gravecaller_focus'],
      mantle_of_borrowed_time: [
        'gravecaller_cloth_mantle',
        'mirefen_leather_shoulderguards',
        'thornpeak_mail_pauldrons',
      ],
      boots_of_the_unbroken_road: [
        'gravecaller_cloth_slippers',
        'mirefen_leather_boots',
        'thornpeak_mail_sabatons',
      ],
    } as const;

    let compatiblePairs = 0;
    for (const powerId of PROCEDURAL_LEGENDARY_POWER_IDS) {
      const expected = new Set<string>(expectedByPower[powerId]);
      for (const base of Object.values(PROCEDURAL_ITEM_BASES)) {
        const compatible = proceduralLegendaryPowerCompatibleWithBase(
          PROCEDURAL_LEGENDARY_POWERS[powerId],
          base,
        );
        expect(compatible, powerId + ' x ' + base.id).toBe(expected.has(base.id));
        if (compatible) compatiblePairs++;
      }
    }

    expect(compatiblePairs).toBe(21);
  });

  it('keeps equipment nouns aligned with compatible slots and weapon types', () => {
    const base = (id: string) => PROCEDURAL_ITEM_BASES[id];
    expect(base('gravecaller_cloth_hood').slot).toBe('helmet');
    expect(base('mirefen_hunting_bow').weaponType).toBe('bow');
    expect(base('mirefen_dirk').weaponType).toBe('dagger');
    expect(base('gravecaller_ring').slot).toBe('ring');
    expect(base('gravecaller_pendant').slot).toBe('neck');

    for (const id of PROCEDURAL_LEGENDARY_POWERS.mantle_of_borrowed_time.compatibleBaseIds) {
      expect(base(id).slot, id).toBe('shoulder');
    }
    for (const id of PROCEDURAL_LEGENDARY_POWERS.boots_of_the_unbroken_road.compatibleBaseIds) {
      expect(base(id).slot, id).toBe('feet');
    }
    for (const id of PROCEDURAL_LEGENDARY_POWERS.greyjaws_edge.compatibleBaseIds) {
      expect(['sword', 'axe', 'mace', 'polearm'], id).toContain(base(id).weaponType);
    }
  });
  it('returns undefined instead of accepting an unknown power ID', () => {
    expect(proceduralLegendaryPower('not_a_power')).toBeUndefined();
  });
});

describe.each(Object.entries(PROCEDURAL_LEGENDARY_POWERS) as [string, EquipmentPowerDefinition][])(
  'legendary power $0',
  (id, power) => {
    it('has a stable lookup identity', () => {
      expect(proceduralLegendaryPower(id)).toBe(power);
    });

    it('uses every magnitude roll key declared by the effect schema', () => {
      for (const effect of power.effects) {
        const rollKey = effect.magnitude?.rollKey;
        if (rollKey) expect(Object.hasOwn(power.rolls, rollKey)).toBe(true);
      }
    });

    it('has no unreferenced persisted rolls', () => {
      const used = new Set(
        power.effects
          .map((effect) => effect.magnitude?.rollKey)
          .filter((rollKey): rollKey is string => rollKey !== undefined),
      );
      expect([...Object.keys(power.rolls)].sort()).toEqual([...used].sort());
    });
  },
);
