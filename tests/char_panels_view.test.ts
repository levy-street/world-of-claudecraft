// Pure char_panels_view core tests (Phase 1, char-equipment redesign): pins the
// three LOCKED stat-id panel lists and cross-checks buildProgressionPanel against
// the real XP tables (src/sim/types.ts) and the exact level-progress math
// src/ui/xp_bar.ts uses, so the character sheet and the HUD xp bar can never
// silently disagree. See tests/gathering_view.test.ts for the house test shape.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MAX_LEVEL, virtualLevel, xpForLevel } from '../src/sim/types';
import {
  ATTRIBUTE_PANEL_STATS,
  buildProgressionPanel,
  buildSpecPanel,
  COMBAT_PANEL_STATS,
  DEFENSE_PANEL_STATS,
} from '../src/ui/char_panels_view';

describe('char_panels_view: locked stat-id panels', () => {
  it('pins ATTRIBUTE_PANEL_STATS to its exact contents and order', () => {
    expect(ATTRIBUTE_PANEL_STATS).toEqual([
      'str',
      'agi',
      'sta',
      'int',
      'spi',
      'armor',
      'attackPower',
      'dps',
      'critChance',
      'dodge',
    ]);
  });

  it('pins COMBAT_PANEL_STATS to its exact contents and order', () => {
    expect(COMBAT_PANEL_STATS).toEqual([
      'attackPower',
      'dps',
      'critChance',
      'critRating',
      'hasteRating',
      'spellPower',
    ]);
  });

  it('pins DEFENSE_PANEL_STATS to its exact contents and order', () => {
    expect(DEFENSE_PANEL_STATS).toEqual(['armor', 'dodge']);
  });

  it('never grows the locked lists with the intentionally-absent stats', () => {
    const all = [...ATTRIBUTE_PANEL_STATS, ...COMBAT_PANEL_STATS, ...DEFENSE_PANEL_STATS];
    for (const banned of ['rangedAttackPower', 'hit', 'block', 'parry', 'resistance']) {
      expect(all).not.toContain(banned);
    }
  });
});

describe('char_panels_view: buildProgressionPanel', () => {
  it('passes totalXp (lifetimeXp) through unchanged', () => {
    const model = buildProgressionPanel({
      lifetimeXp: 123_456,
      xp: 200,
      level: 5,
      prestigeRank: 0,
    });
    expect(model.totalXp).toBe(123_456);
  });

  it('agrees with virtualLevel() from sim/types at 0, mid, and huge lifetime XP', () => {
    for (const lifetimeXp of [0, 50_000, 5_000_000]) {
      const model = buildProgressionPanel({ lifetimeXp, xp: 0, level: 1, prestigeRank: 0 });
      expect(model.virtualLevel).toBe(virtualLevel(lifetimeXp));
    }
  });

  it('reports the level-XP bar at a low level exactly like xp_bar.ts (need = xpForLevel(level))', () => {
    const level = 2;
    const xp = 300;
    const model = buildProgressionPanel({ lifetimeXp: 999, xp, level, prestigeRank: 0 });
    expect(model.atMaxLevel).toBe(false);
    expect(model.levelXpMax).toBe(xpForLevel(level));
    expect(model.levelXp).toBe(xp);
  });

  it('reports the level-XP bar at a mid level exactly like xp_bar.ts', () => {
    const level = 10;
    const xp = 4000;
    const model = buildProgressionPanel({ lifetimeXp: 500_000, xp, level, prestigeRank: 0 });
    expect(model.atMaxLevel).toBe(false);
    expect(model.levelXpMax).toBe(xpForLevel(level));
    expect(model.levelXp).toBe(xp);
  });

  it('stays below max at MAX_LEVEL - 1 (catches an off-by-one in the cap check)', () => {
    const level = MAX_LEVEL - 1;
    const xp = 12_000;
    const model = buildProgressionPanel({ lifetimeXp: 400_000, xp, level, prestigeRank: 0 });
    expect(model.atMaxLevel).toBe(false);
    expect(model.levelXpMax).toBe(xpForLevel(MAX_LEVEL - 1));
    expect(model.levelXp).toBe(xp);
  });

  it('reports atMaxLevel true at MAX_LEVEL with a zeroed, safe level bar', () => {
    const model = buildProgressionPanel({
      lifetimeXp: 5_000_000,
      xp: 999,
      level: MAX_LEVEL,
      prestigeRank: 0,
    });
    expect(model.atMaxLevel).toBe(true);
    // Both zeroed so the painter reads atMaxLevel (a full, label-less bar) and no
    // consumer divides by a nonzero max at the cap.
    expect(model.levelXpMax).toBe(0);
    expect(model.levelXp).toBe(0);
  });

  it('treats any level past MAX_LEVEL as atMaxLevel too', () => {
    const model = buildProgressionPanel({
      lifetimeXp: 5_000_000,
      xp: 999,
      level: MAX_LEVEL + 5,
      prestigeRank: 0,
    });
    expect(model.atMaxLevel).toBe(true);
    expect(model.levelXpMax).toBe(0);
  });

  it('passes prestigeRank through unchanged (the painter hides the row when 0)', () => {
    expect(
      buildProgressionPanel({ lifetimeXp: 0, xp: 0, level: 1, prestigeRank: 3 }).prestigeRank,
    ).toBe(3);
    expect(
      buildProgressionPanel({ lifetimeXp: 0, xp: 0, level: 1, prestigeRank: 0 }).prestigeRank,
    ).toBe(0);
  });

  it('is a pure function: same input yields an equal model', () => {
    const input = { lifetimeXp: 42, xp: 10, level: 3, prestigeRank: 0 };
    expect(buildProgressionPanel(input)).toEqual(buildProgressionPanel(input));
  });

  it('yields an identical model from a Sim-shaped and a ClientWorld-mirror input', () => {
    const simInput = Object.assign(Object.create({ dirty: true }), {
      lifetimeXp: 777,
      xp: 55,
      level: 4,
      prestigeRank: 0,
    });
    const mirrorInput = JSON.parse(JSON.stringify(simInput)) as typeof simInput;
    expect(buildProgressionPanel(simInput)).toEqual(buildProgressionPanel(mirrorInput));
  });
});

describe('char_panels_view: buildSpecPanel', () => {
  it('models no specialization chosen', () => {
    expect(buildSpecPanel(null)).toEqual({ specId: null });
  });

  it('models a real chosen specialization id (warrior "arms")', () => {
    expect(buildSpecPanel('arms')).toEqual({ specId: 'arms' });
  });

  it('is a pure function: same input yields an equal model', () => {
    expect(buildSpecPanel('arms')).toEqual(buildSpecPanel('arms'));
  });
});

describe('char_panels_view: scoped to deterministic panel data (no DOM/Three/i18n/RNG)', () => {
  const src = readFileSync(new URL('../src/ui/char_panels_view.ts', import.meta.url), 'utf8');

  it('draws no randomness or wall-clock time', () => {
    expect(src).not.toMatch(/\bMath\.random\b/);
    expect(src).not.toMatch(/\bDate\.now\b/);
    expect(src).not.toMatch(/\bperformance\.now\b/);
  });

  it('imports no DOM/Three/i18n and no render or *_window/*_painter modules', () => {
    expect(src).not.toMatch(/from\s+['"]\.\.\/render\//);
    expect(src).not.toMatch(/from\s+['"]three['"]/);
    expect(src).not.toMatch(/from\s+['"]\.\/i18n['"]/);
    expect(src).not.toMatch(/_window['"]/);
    expect(src).not.toMatch(/_painter['"]/);
    expect(src).not.toMatch(/\bdocument\./);
    expect(src).not.toMatch(/\bTHREE\b/);
  });
});
