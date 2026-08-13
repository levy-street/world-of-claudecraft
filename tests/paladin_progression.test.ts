import { describe, expect, it } from 'vitest';
import { ABILITIES, abilitiesKnownAt } from '../src/sim/content/classes';
import { computeTalentModifiers } from '../src/sim/content/talents';

type PaladinSpec = 'holy' | 'protection' | 'retribution';

const GENERAL_LEVELS = {
  holy_light: 1,
  divine_ascension: 1,
  hammer_of_justice: 2,
  hammer_of_grace: 3,
  devotion_ward: 4,
  dawn_devotion: 5,
  solar_step: 5,
  divine_protection: 6,
  recall_the_fallen: 6,
  retribution_aura: 7,
  grace_devotion: 8,
  lay_on_hands: 8,
  radiant_devotion: 10,
  avenging_wrath: 14,
} as const;

const SPEC_LEVELS = {
  holy: {
    sacred_form: 5,
    mercy_lance: 8,
    solar_invocation: 9,
    life_covenant: 10,
    dawns_embrace: 13,
    radiant_chorus: 14,
    beacon_of_light: 16,
    aegis_first_dawn: 18,
  },
  protection: {
    vowkeeper_strike: 5,
    righteous_fury: 5,
    consecration: 5,
    sacred_challenge: 6,
    bastion_rite: 7,
    hushbrand: 10,
    sunward_disc: 10,
    bastion_sweep: 11,
    holy_shield: 13,
    oath_chain: 14,
    veilbound_march: 18,
  },
  retribution: {
    consecration: 5,
    final_edict: 8,
    faithforged_guard: 9,
    hushbrand: 10,
    dawnfall: 12,
    guardian_covenant: 12,
    valkyrs_calling: 13,
    hammer_of_wrath: 14,
    sun_gods_verdict: 17,
  },
} as const satisfies Record<PaladinSpec, Record<string, number>>;

const QUESTS_DONE = new Set(['q_rite_of_redemption']);

function knownAt(spec: PaladinSpec, level: number): string[] {
  const mods = computeTalentModifiers('paladin', { spec, ranks: {}, choices: {} }, level);
  return abilitiesKnownAt('paladin', level, mods, QUESTS_DONE).map(({ def }) => def.id);
}

function knownWithoutSpec(level: number): string[] {
  const mods = computeTalentModifiers('paladin', { spec: null, ranks: {}, choices: {} }, level);
  return abilitiesKnownAt('paladin', level, mods, QUESTS_DONE).map(({ def }) => def.id);
}

describe('Paladin final progression', () => {
  it('pins every visible general and specialization learn level', () => {
    for (const [id, level] of Object.entries(GENERAL_LEVELS)) {
      expect(ABILITIES[id].learnLevel, id).toBe(level);
      expect(ABILITIES[id].specs, id).toBeUndefined();
    }
    for (const [spec, levels] of Object.entries(SPEC_LEVELS)) {
      for (const [id, level] of Object.entries(levels)) {
        expect(ABILITIES[id].learnLevel, `${spec}:${id}`).toBe(level);
        expect(ABILITIES[id].specs, `${spec}:${id}`).toContain(spec);
      }
    }
  });

  it('unlocks every level-gated ability at its exact boundary', () => {
    for (const spec of Object.keys(SPEC_LEVELS) as PaladinSpec[]) {
      const levels = { ...GENERAL_LEVELS, ...SPEC_LEVELS[spec] };
      for (const [id, level] of Object.entries(levels)) {
        expect(knownAt(spec, level), `${spec}:${id} at ${level}`).toContain(id);
        if (level > 1) {
          expect(knownAt(spec, level - 1), `${spec}:${id} before ${level}`).not.toContain(id);
        }
      }
    }
  });

  it('exposes an exact level-20 kit for each specialization', () => {
    for (const spec of Object.keys(SPEC_LEVELS) as PaladinSpec[]) {
      const expected = [...Object.keys(GENERAL_LEVELS), ...Object.keys(SPEC_LEVELS[spec])].sort();
      expect(knownAt(spec, 20).sort(), spec).toEqual(expected);
    }
  });

  it('exposes only the general kit before a specialization is selected', () => {
    expect(knownWithoutSpec(20).sort()).toEqual(Object.keys(GENERAL_LEVELS).sort());
  });

  it('does not export removed Paladin talent abilities', () => {
    for (const id of ['cleansing_verdict', 'holy_wrath', 'divine_shield', 'aura_surge']) {
      expect(ABILITIES, id).not.toHaveProperty(id);
    }
  });

  // The three early-damage curves. Each ability is learned well before its power
  // peaks, so the opening rank has to sit near its level peers rather than at the
  // level-20 value: a flat rank 1 is what made all three outscale the rest of the
  // game at levels 3 to 8. Pinned as a curve, ascending and ending on the tuned
  // end state, so a future edit cannot quietly flatten it back.
  it('ramps the early damage curves instead of opening at full power', () => {
    const curves: Record<string, { levels: number[]; opening: number; peak: number }> = {
      hammer_of_grace: { levels: [3, 8, 14], opening: 30, peak: 95 },
      consecration: { levels: [5, 11, 16], opening: 9, peak: 22 },
      final_edict: { levels: [8, 13, 17], opening: 20, peak: 52 },
    };
    for (const [id, curve] of Object.entries(curves)) {
      const def = ABILITIES[id];
      const ranks = def.ranks ?? [];
      expect(ranks, `${id} must be ranked`).toHaveLength(2);
      expect([def.learnLevel, ...ranks.map((r) => r.level)], `${id} rank levels`).toEqual(
        curve.levels,
      );

      const power = (effects: readonly { type: string }[]): number => {
        const e = effects[0] as { min?: number; bonus?: number };
        return e.min ?? e.bonus ?? 0;
      };
      const values = [power(def.effects), ...ranks.map((r) => power(r.effects))];
      expect(values[0], `${id} opening rank`).toBe(curve.opening);
      expect(values[values.length - 1], `${id} peak rank`).toBe(curve.peak);
      for (let i = 1; i < values.length; i++) {
        expect(values[i], `${id} rank ${i + 1} climbs`).toBeGreaterThan(values[i - 1]);
      }
    }
  });
});
