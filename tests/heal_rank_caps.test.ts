import { describe, expect, it } from 'vitest';
import { ABILITIES } from '../src/sim/content/classes';
import type { AbilityDef } from '../src/sim/types';

// The 2026-07 healers-vs-heroics cap retune: heal ladders get their missing
// level-20 step. Pools and heroic damage outscaled heals across releases while
// the rank ladders stood still, so every mainline heal either gains a NEW cap
// rank at level 20 (~1.45x its old top, following the ladder's own cadence) or,
// where the top rank was already learned AT 20, that endgame-only rank is
// revalued in place. Sub-cap ranks are pinned UNTOUCHED: leveling healing was
// proportionate and stays exactly as it was.
//
// Skipped by policy (descriptions hardcode their numbers; ranking them would
// make tooltips lie, and the reword is an i18n follow-up): chain_heal,
// healing_stream, tranquility.

function def(id: string): AbilityDef {
  const found = (ABILITIES as Record<string, AbilityDef>)[id];
  expect(found, id).toBeTruthy();
  return found;
}

type Row = { level: number; cost: number; effects: string };

function fmtEffects(effects: AbilityDef['effects']): string {
  return effects
    .map((e) => {
      const any = e as Record<string, unknown>;
      if ('min' in any && 'max' in any) return `${e.type} ${any.min}-${any.max}`;
      if ('total' in any) return `${e.type} ${any.total}/${any.duration}`;
      if ('amount' in any) return `${e.type} ${any.amount}`;
      return e.type;
    })
    .join(' + ');
}

function ladder(id: string): Row[] {
  const a = def(id);
  return [
    { level: a.learnLevel, cost: a.cost, effects: fmtEffects(a.effects) },
    ...(a.ranks ?? []).map((r) => ({
      level: r.level,
      cost: r.cost ?? a.cost,
      effects: fmtEffects(r.effects),
    })),
  ];
}

const EXPECTED: Record<string, Row[]> = {
  // ---- priest
  lesser_heal: [
    { level: 1, cost: 30, effects: 'heal 47-58' },
    { level: 6, cost: 45, effects: 'heal 72-86' },
    { level: 12, cost: 65, effects: 'heal 110-132' },
    { level: 20, cost: 85, effects: 'heal 160-192' }, // NEW cap rank
  ],
  heal: [
    { level: 14, cost: 95, effects: 'heal 165-195' },
    { level: 20, cost: 130, effects: 'heal 335-390' }, // revalued cap (was 230-270)
  ],
  flash_heal: [
    { level: 20, cost: 75, effects: 'heal 174-206' }, // revalued (was 120-142), learned at 20
  ],
  renew: [
    { level: 8, cost: 30, effects: 'hot 45/15' },
    { level: 14, cost: 50, effects: 'hot 90/15' },
    { level: 20, cost: 75, effects: 'hot 205/15' }, // revalued cap (was 140)
  ],
  power_word_shield: [
    { level: 6, cost: 45, effects: 'absorb 48' },
    { level: 12, cost: 70, effects: 'absorb 90' },
    { level: 18, cost: 100, effects: 'absorb 145' },
    { level: 20, cost: 130, effects: 'absorb 210' }, // NEW cap rank
  ],
  prayer_of_healing: [
    { level: 10, cost: 130, effects: 'aoeHeal 100-122' },
    { level: 20, cost: 170, effects: 'aoeHeal 145-177' }, // NEW cap rank
  ],
  holy_nova: [
    { level: 10, cost: 70, effects: 'aoeHeal 34-42 + aoeDamage 24-30' },
    { level: 20, cost: 90, effects: 'aoeHeal 49-61 + aoeDamage 24-30' }, // NEW: heal side only
  ],
  // ---- shaman
  healing_wave: [
    { level: 1, cost: 25, effects: 'heal 36-44' },
    { level: 6, cost: 40, effects: 'heal 56-68' },
    { level: 12, cost: 65, effects: 'heal 92-110' },
    { level: 18, cost: 90, effects: 'heal 138-164' },
    { level: 20, cost: 115, effects: 'heal 200-238' }, // NEW cap rank
  ],
  // ---- druid
  healing_touch: [
    { level: 1, cost: 25, effects: 'heal 37-51' },
    { level: 8, cost: 45, effects: 'heal 68-86' },
    { level: 14, cost: 75, effects: 'heal 115-140' },
    { level: 20, cost: 110, effects: 'heal 254-302' }, // revalued cap (was 175-208)
  ],
  rejuvenation: [
    { level: 4, cost: 25, effects: 'hot 32/12' },
    { level: 10, cost: 40, effects: 'hot 56/12' },
    { level: 16, cost: 60, effects: 'hot 88/12' },
    { level: 20, cost: 80, effects: 'hot 168/12' }, // revalued cap (was 116)
  ],
  regrowth: [
    { level: 14, cost: 55, effects: 'heal 52-62 + hot 49/21' },
    { level: 20, cost: 72, effects: 'heal 75-90 + hot 71/21' }, // NEW cap rank
  ],
  // ---- paladin
  holy_light: [
    { level: 1, cost: 25, effects: 'heal 42-51' },
    { level: 8, cost: 50, effects: 'heal 76-90' },
    { level: 14, cost: 70, effects: 'heal 122-144' },
    { level: 20, cost: 117, effects: 'heal 275-322' }, // revalued cap (was 190-222)
  ],
  flash_of_light: [
    { level: 12, cost: 35, effects: 'heal 62-76' },
    { level: 20, cost: 46, effects: 'heal 90-110' }, // NEW cap rank
  ],
  holy_shock: [
    { level: 10, cost: 55, effects: 'heal 40-50 + directDamage 40-50' },
    { level: 20, cost: 72, effects: 'heal 58-73 + directDamage 40-50' }, // NEW: heal side only
  ],
};

describe('heal rank cap retune (2026-07)', () => {
  for (const [id, rows] of Object.entries(EXPECTED)) {
    it(`${id}: sub-cap ranks untouched, cap rank at the retuned values`, () => {
      expect(ladder(id)).toEqual(rows);
    });
  }

  it('every new or revalued cap rank sits at level 20: leveling is untouched', () => {
    for (const rows of Object.values(EXPECTED)) {
      expect(rows[rows.length - 1].level).toBe(20);
    }
  });
});
