import { describe, expect, it } from 'vitest';
import { CHOICE_ROWS, validateRows } from '../src/sim/content/choice_rows';
import {
  computeTalentModifiers,
  exportBuild,
  importBuild,
  repairAllocation,
  validateAllocation,
} from '../src/sim/content/talents';
import { ABILITIES } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import type { PlayerClass } from '../src/sim/types';

const CLASSES: PlayerClass[] = [
  'warrior',
  'paladin',
  'hunter',
  'mage',
  'rogue',
  'priest',
  'shaman',
  'warlock',
  'druid',
];

describe('choice row engine', () => {
  it('every class registers exactly 6 rows of 3 options with unique ids', () => {
    const seen = new Set<string>();
    for (const cls of CLASSES) {
      const rows = CHOICE_ROWS[cls]?.rows ?? [];
      expect(rows.length, cls).toBe(6);
      expect(rows.map((r) => r.level)).toEqual([5, 8, 11, 14, 17, 20]);
      for (const row of rows) {
        expect(row.options.length).toBe(3);
        for (const o of row.options) {
          expect(seen.has(o.id), `duplicate option id ${o.id}`).toBe(false);
          seen.add(o.id);
        }
      }
    }
    expect(seen.size).toBe(162);
  });

  it('validates level gates and option ownership', () => {
    const r5 = CHOICE_ROWS.warrior.rows[0].options[0].id;
    const r20 = CHOICE_ROWS.warrior.rows[5].options[0].id;
    expect(validateRows('warrior', 5, { 5: r5 }).ok).toBe(true);
    expect(validateRows('warrior', 4, { 5: r5 }).ok).toBe(false);
    expect(validateRows('warrior', 19, { 20: r20 }).ok).toBe(false);
    expect(validateRows('warrior', 20, { 20: r20 }).ok).toBe(true);
    expect(validateRows('warrior', 20, { 5: 'mag_r5_not_ours' }).ok).toBe(false);
    expect(validateAllocation('warrior', { spec: null, rows: { 5: r5 } }, 20).ok).toBe(true);
  });

  it('repair drops illegal picks and keeps legal ones (the free re-pick migration)', () => {
    const r5 = CHOICE_ROWS.mage.rows[0].options[1].id;
    const repaired = repairAllocation(
      'mage',
      { spec: null, rows: { 5: r5, 20: 'war_r20_bogus' } },
      12,
    );
    expect(repaired.rows).toEqual({ 5: r5 });
  });

  it('a picked option folds into TalentModifiers (grants included)', () => {
    // hunter r8 counter_shot style rows carry grants; find any grant-bearing option.
    let cls: PlayerClass | null = null;
    let level = 0;
    let optId = '';
    let granted = '';
    outer: for (const c of CLASSES) {
      for (const row of CHOICE_ROWS[c].rows) {
        for (const o of row.options) {
          const g = o.effect.grant;
          if (g) {
            cls = c;
            level = row.level;
            optId = o.id;
            granted = g.ability;
            break outer;
          }
        }
      }
    }
    expect(cls).not.toBeNull();
    const mods = computeTalentModifiers(
      cls as PlayerClass,
      { spec: null, rows: { [level]: optId } },
      20,
    );
    expect(mods.grants.some((g) => g.ability === granted)).toBe(true);
  });

  it('every grant-bearing option is named after its granted ability (i18n free)', () => {
    for (const cls of CLASSES) {
      for (const row of CHOICE_ROWS[cls].rows) {
        for (const o of row.options) {
          const g = o.effect.grant?.ability;
          if (!g) continue;
          expect(ABILITIES[g], `${o.id} grants unknown ability ${g}`).toBeTruthy();
          expect(o.name, `${o.id} name must match ${g}'s display name`).toBe(ABILITIES[g].name);
        }
      }
    }
  });

  it('build strings round-trip rows', () => {
    const r5 = CHOICE_ROWS.rogue.rows[0].options[2].id;
    const alloc = { spec: null, rows: { 5: r5 } };
    const imported = importBuild(exportBuild('rogue', alloc));
    expect(imported.ok).toBe(true);
    if (imported.ok) expect(imported.alloc.rows).toEqual({ 5: r5 });
  });

  it('a live sim applies a row pick end to end and persists it', () => {
    const sim = new Sim({ seed: 3, playerClass: 'warrior', autoEquip: true });
    sim.setPlayerLevel(20);
    const r5 = CHOICE_ROWS.warrior.rows[0].options[0].id;
    sim.applyTalents({ spec: 'arms', rows: { 5: r5 } });
    expect(sim.talents.rows).toEqual({ 5: r5 });
    const saved = sim.serializeCharacter(sim.playerId);
    expect(saved?.talents?.rows).toEqual({ 5: r5 });
  });
});
