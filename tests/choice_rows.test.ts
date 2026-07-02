import { afterEach, describe, expect, it } from 'vitest';
import {
  CHOICE_ROWS,
  type ClassChoiceRows,
  repairRows,
  validateRows,
} from '../src/sim/content/choice_rows';
import {
  computeTalentModifiers,
  emptyAllocation,
  exportBuild,
  importBuild,
  repairAllocation,
  type TalentAllocation,
  validateAllocation,
} from '../src/sim/content/talents';
import { Sim } from '../src/sim/sim';
import { ALL_CLASSES, MAX_LEVEL } from '../src/sim/types';

const cls = 'warrior';
const originalRows = CHOICE_ROWS[cls];

const fixtureRows: ClassChoiceRows = {
  rows: [
    {
      level: 5,
      theme: 'fixture',
      options: [
        {
          id: 'fixture_sta',
          name: 'Fixture Stamina',
          description: 'Adds stamina.',
          icon: 'fixture_sta',
          effect: { stats: { sta: 10 } },
        },
        {
          id: 'fixture_str',
          name: 'Fixture Strength',
          description: 'Adds strength.',
          icon: 'fixture_str',
          effect: { stats: { str: 5 } },
        },
        {
          id: 'fixture_fireball',
          name: 'Fixture Fireball',
          description: 'Improves Heroic Strike.',
          icon: 'fixture_fireball',
          effect: { ability: [{ ability: 'heroic_strike', dmgPct: 0.25 }] },
        },
      ],
    },
  ],
};

function withRows(): void {
  CHOICE_ROWS[cls] = fixtureRows;
}

function alloc(over: Partial<TalentAllocation> = {}): TalentAllocation {
  return { ...emptyAllocation(), ...over };
}

function simAtCap(): Sim {
  const sim = new Sim({ seed: 123, playerClass: cls });
  sim.setPlayerLevel(MAX_LEVEL);
  return sim;
}

afterEach(() => {
  CHOICE_ROWS[cls] = originalRows;
});

describe('choice row validation and repair', () => {
  it('rejects unknown levels, wrong options, underlevel picks, and empty dormant rows', () => {
    withRows();
    expect(validateRows(cls, 20, { 6: 'fixture_sta' } as never).ok).toBe(false);
    expect(validateRows(cls, 20, { 5: 'missing' }).ok).toBe(false);
    expect(validateRows(cls, 4, { 5: 'fixture_sta' }).ok).toBe(false);
    expect(validateRows(cls, 20, { 5: 'fixture_sta', '05': 'fixture_str' } as never).ok).toBe(
      false,
    );

    CHOICE_ROWS[cls] = { rows: [] };
    expect(validateRows(cls, 20, { 5: 'fixture_sta' }).ok).toBe(false);
  });

  it('drops invalid picks during repair', () => {
    withRows();
    expect(
      repairRows(cls, 20, {
        5: 'fixture_sta',
        8: 'missing',
        11: '',
      }),
    ).toEqual({ 5: 'fixture_sta' });
  });

  it('validates rows as part of the whole allocation', () => {
    withRows();
    expect(validateAllocation(cls, alloc({ rows: { 5: 'fixture_sta' } }), 0, 5).ok).toBe(true);
    expect(validateAllocation(cls, alloc({ rows: { 5: 'fixture_sta' } }), 0, 4).ok).toBe(false);
    expect(validateAllocation(cls, alloc({ rows: { 5: 'missing' } }), 0, 20).ok).toBe(false);
  });

  it('repairs stale allocation rows on load', () => {
    withRows();
    const repaired = repairAllocation(
      cls,
      alloc({ rows: { 5: 'fixture_sta', 8: 'missing' } }),
      0,
      20,
    );
    expect(repaired.rows).toEqual({ 5: 'fixture_sta' });
  });

  it('round-trips rows through build strings', () => {
    const imported = importBuild(exportBuild(cls, alloc({ rows: { 5: 'fixture_sta' } })));
    expect(imported.ok).toBe(true);
    if (imported.ok) expect(imported.alloc.rows).toEqual({ 5: 'fixture_sta' });
  });
});

describe('choice row effects and sim facade', () => {
  it('folds fixture option effects into baked talent modifiers and recalculated stats', () => {
    withRows();
    const mods = computeTalentModifiers(cls, alloc({ rows: { 5: 'fixture_sta' } }));
    expect(mods.stats.sta).toBe(10);

    const sim = simAtCap();
    const before = sim.player.stats.sta;
    expect(sim.chooseRow(5, 'fixture_sta')).toBe(true);
    expect(sim.talents.rows).toEqual({ 5: 'fixture_sta' });
    expect(sim.player.stats.sta).toBe(before + 10);
  });

  it('applies and resets rows through the Sim facade with combat and arena locks', () => {
    withRows();
    const sim = simAtCap();
    expect(sim.chooseRow(5, 'fixture_sta')).toBe(true);
    expect(sim.resetRows()).toBe(true);
    expect(sim.talents.rows).toEqual({});

    sim.player.inCombat = true;
    expect(sim.chooseRow(5, 'fixture_sta')).toBe(false);
    sim.player.inCombat = false;

    sim.arenaMatches.set(sim.playerId, {} as never);
    expect(sim.chooseRow(5, 'fixture_sta')).toBe(false);
    expect(sim.resetRows()).toBe(false);
  });

  it('round-trips rows through persistence and saved loadouts', () => {
    withRows();
    const sim = simAtCap();
    expect(sim.chooseRow(5, 'fixture_sta')).toBe(true);
    expect(sim.saveLoadout('Rows', [])).toBe(0);
    expect(sim.resetRows()).toBe(true);
    expect(sim.switchLoadout(0)).toBe(true);
    expect(sim.talents.rows).toEqual({ 5: 'fixture_sta' });
    expect(sim.loadouts[0].alloc.rows).toEqual({ 5: 'fixture_sta' });

    const state = sim.serializeCharacter(sim.playerId);
    expect(state).not.toBeNull();
    if (!state) throw new Error('expected serialized character state');
    const restored = new Sim({ seed: 456, playerClass: cls, noPlayer: true });
    const pid = restored.addPlayer(cls, 'Restored', { state });
    expect(restored.meta(pid)?.talents.rows).toEqual({ 5: 'fixture_sta' });
    expect(restored.meta(pid)?.loadouts[0].alloc.rows).toEqual({ 5: 'fixture_sta' });
  });

  it('ships dormant empty rows for every class', () => {
    for (const playerClass of ALL_CLASSES) {
      expect(CHOICE_ROWS[playerClass].rows).toEqual([]);
      expect(validateRows(playerClass, 20, { 5: 'anything' }).ok).toBe(false);
    }
  });
});
