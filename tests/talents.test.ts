import { describe, expect, it } from 'vitest';
import {
  computeTalentModifiers,
  emptyAllocation,
  exportBuild,
  FIRST_TALENT_LEVEL,
  importBuild,
  repairAllocation,
  TALENT_BUILD_VERSION,
  TALENTS,
  talentsFor,
  type TalentAllocation,
  validateAllocation,
} from '../src/sim/content/talents';
import { Sim } from '../src/sim/sim';
import { MAX_LEVEL, type PlayerClass } from '../src/sim/types';

const alloc = (over: Partial<TalentAllocation> = {}): TalentAllocation => ({
  ...emptyAllocation(),
  ...over,
});

const classes = Object.keys(TALENTS) as PlayerClass[];

describe('talents registry after the flip', () => {
  it('keeps specs for every class and retires node tables', () => {
    for (const cls of classes) {
      const ct = talentsFor(cls);
      expect(ct?.nodes).toEqual([]);
      expect(ct?.specs).toHaveLength(3);
      for (const spec of ct?.specs ?? []) {
        expect(spec.signature).toBeTruthy();
        expect(spec.mastery.effect).toBeTruthy();
      }
    }
  });

  it('empty and clone allocation are exactly spec plus rows', () => {
    const empty = emptyAllocation();
    expect(empty).toEqual({ spec: null, rows: {} });
    const clone = { ...empty, rows: { 5: 'war_r5_juggernaut' } };
    expect(Object.keys(clone).sort()).toEqual(['rows', 'spec']);
  });
});

describe('rows-only validation and repair', () => {
  it('keeps the level 10 specialization gate', () => {
    expect(validateAllocation('warrior', alloc({ spec: 'arms' }), FIRST_TALENT_LEVEL - 1).ok).toBe(false);
    expect(validateAllocation('warrior', alloc({ spec: 'arms' }), FIRST_TALENT_LEVEL).ok).toBe(true);
  });

  it('validates row options by row unlock level', () => {
    expect(validateAllocation('warrior', alloc({ rows: { 5: 'war_r5_juggernaut' } }), 5).ok).toBe(true);
    expect(validateAllocation('warrior', alloc({ rows: { 8: 'war_r8_pummel' } }), 7).ok).toBe(false);
    expect(validateAllocation('warrior', alloc({ rows: { 5: 'missing' } }), MAX_LEVEL).ok).toBe(false);
  });

  it('repairs legacy allocations by dropping ranks and choices while keeping valid spec and rows', () => {
    const legacy = {
      spec: 'arms',
      ranks: { war_toughness: 3 },
      choices: { war_tactical_choice: 'tc_cruelty' },
      rows: { 5: 'war_r5_juggernaut', 20: 'missing' },
    } as unknown as TalentAllocation;
    expect(repairAllocation('warrior', legacy, MAX_LEVEL)).toEqual({
      spec: 'arms',
      rows: { 5: 'war_r5_juggernaut' },
    });
  });
});

describe('build strings', () => {
  it('exports version 2 rows-only payloads and imports them', () => {
    const build = exportBuild(
      'warrior',
      alloc({ spec: 'arms', rows: { 5: 'war_r5_juggernaut', 14: 'war_r14_mortal_strike' } }),
    );
    const imported = importBuild(build);
    expect(imported.ok).toBe(true);
    if (imported.ok) {
      expect(imported.cls).toBe('warrior');
      expect(imported.alloc).toEqual({
        spec: 'arms',
        rows: { 5: 'war_r5_juggernaut', 14: 'war_r14_mortal_strike' },
      });
    }
  });

  it('rejects old version 1 point-tree build strings', () => {
    const old = Buffer.from(
      JSON.stringify({ v: 1, c: 'warrior', s: 'arms', r: { war_toughness: 1 }, h: {}, w: {} }),
      'utf8',
    ).toString('base64');
    expect(TALENT_BUILD_VERSION).toBe(2);
    expect(importBuild(old)).toMatchObject({ ok: false });
    expect(importBuild('not-base64-$$$')).toMatchObject({ ok: false });
  });
});

describe('modifier folding', () => {
  it('folds only spec mastery, signature grant, and row effects', () => {
    const mods = computeTalentModifiers(
      'warrior',
      alloc({ spec: 'arms', rows: { 14: 'war_r14_mortal_strike' } }),
    );
    expect(mods.spec).toBe('arms');
    expect(mods.grants.some((grant) => grant.ability === 'mortal_strike')).toBe(true);
    expect(mods.global.meleeDmgPct).toBeGreaterThan(0);
    expect(mods.abilities.mortal_strike.dmgPct).toBeGreaterThan(0);
  });
});

describe('Sim facade and persistence', () => {
  it('applies rows-only allocations and loadouts through the Sim facade', () => {
    const sim = new Sim({ seed: 10, playerClass: 'warrior' });
    sim.setPlayerLevel(MAX_LEVEL);
    expect(sim.applyTalents(alloc({ spec: 'arms', rows: { 5: 'war_r5_juggernaut' } }))).toBe(true);
    expect(sim.talents).toEqual({ spec: 'arms', rows: { 5: 'war_r5_juggernaut' } });
    expect(sim.saveLoadout('Rows', [], alloc({ spec: 'fury', rows: { 8: 'war_r8_pummel' } }))).toBe(0);
    expect(sim.loadouts[0].alloc).toEqual({ spec: 'fury', rows: { 8: 'war_r8_pummel' } });
  });

  it('legacy persisted saves load with ranks and choices dropped', () => {
    const source = new Sim({ seed: 11, playerClass: 'warrior' });
    source.setPlayerLevel(MAX_LEVEL);
    const state = source.serializeCharacter(source.playerId)!;
    state.talents = {
      spec: 'arms',
      ranks: { war_toughness: 3 },
      choices: { war_tactical_choice: 'tc_cruelty' },
      rows: { 5: 'war_r5_juggernaut' },
    } as unknown as TalentAllocation;

    const restored = new Sim({ seed: 12, playerClass: 'warrior', noPlayer: true });
    const pid = restored.addPlayer('warrior', 'Restored', { state });
    expect(restored.meta(pid)?.talents).toEqual({
      spec: 'arms',
      rows: { 5: 'war_r5_juggernaut' },
    });
  });
});
