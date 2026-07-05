import { describe, expect, it } from 'vitest';
import { ACTIONS, NUM_ACTIONS, encodeObs, obsSize } from '../src/sim/obs';
import { CLASSES } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import { ALL_CLASSES } from '../src/sim/types';
import { MAX_INPUT_LINE_LENGTH, validateAction, validatePlayerClass } from '../headless/protocol';

describe('headless environment protocol validation', () => {
  it('accepts only integer action ids from the declared action space', () => {
    expect(validateAction(0)).toBe(0);
    expect(validateAction(NUM_ACTIONS - 1)).toBe(NUM_ACTIONS - 1);
    expect(validateAction(-1)).toBeNull();
    expect(validateAction(NUM_ACTIONS)).toBeNull();
    expect(validateAction(1.5)).toBeNull();
    expect(validateAction('1')).toBeNull();
    expect(validateAction(Number.NaN)).toBeNull();
  });

  it('accepts every declared player class and rejects anything else', () => {
    // all 9 classes are valid env inputs, not just warrior/mage
    for (const cls of ALL_CLASSES) {
      expect(validatePlayerClass(cls)).toBe(cls);
    }
    expect(ALL_CLASSES.length).toBe(9);
    expect(validatePlayerClass('warlock')).toBe('warlock');
    expect(validatePlayerClass('necromancer')).toBeNull();
    expect(validatePlayerClass('')).toBeNull();
    expect(validatePlayerClass(' warrior')).toBeNull(); // no trimming
    expect(validatePlayerClass(undefined)).toBeNull();
    expect(validatePlayerClass(null)).toBeNull();
    expect(validatePlayerClass(0)).toBeNull();
    expect(validatePlayerClass('Warrior')).toBeNull(); // case-sensitive
  });

  it('builds an identical-shape, full-size, finite observation for every class', () => {
    // Loop ALL_CLASSES (not a hardcoded subset) so all 9 obs vectors are guarded
    // and a 10th class would self-extend the check. The obs space is content-scaled
    // and class-agnostic (ability slots pad to the largest kit), so every class
    // yields the same-length vector as the advertised obsSize(): switching
    // player_class never silently changes a trained config's obs shape.
    const sizes = new Set<number>();
    for (const cls of ALL_CLASSES) {
      const obs = encodeObs(new Sim({ seed: 7, playerClass: cls, autoEquip: true }));
      expect(obs.every((v) => Number.isFinite(v))).toBe(true);
      // every value stays inside the Python Gym observation_space Box(-2, 2)
      // (python/wow_env.py), so the cross-language obs contract holds for all 9 classes
      expect(obs.every((v) => v >= -2 && v <= 2)).toBe(true);
      sizes.add(obs.length);
    }
    // a single distinct length across all 9 classes, equal to the advertised
    // obsSize(): a trained config's obs vector shape is identical for every class.
    expect(sizes).toEqual(new Set([obsSize()]));
  });

  it('sizes the action space to the largest class kit so every class is castable', () => {
    // The action space is a module constant with no class input, so num_actions is
    // identical for every player_class. Its ability slots are sized to the largest
    // class kit, so no class's learnable abilities fall outside ACTIONS: a trained
    // policy's action head stays valid across all 9 classes.
    const abilitySlots = ACTIONS.filter((a) => a.startsWith('ability_')).length;
    const maxKit = Math.max(...ALL_CLASSES.map((cls) => CLASSES[cls].abilities.length));
    expect(abilitySlots).toBe(maxKit);
    for (const cls of ALL_CLASSES) {
      expect(CLASSES[cls].abilities.length).toBeLessThanOrEqual(abilitySlots);
    }
    // 13 fixed actions (10 move/target + interact/stop/eat_drink) plus the ability slots
    expect(NUM_ACTIONS).toBe(13 + abilitySlots);
  });

  it('keeps the stdin line cap at one mebibyte', () => {
    expect(MAX_INPUT_LINE_LENGTH).toBe(1024 * 1024);
  });
});
