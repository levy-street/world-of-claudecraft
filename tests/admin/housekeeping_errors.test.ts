// Reverse-matcher for game-config validation diagnostics (Node env): every
// shape validateGameConfig emits must be recognized, and unknown lines fall
// through to English unchanged.
import { describe, expect, it } from 'vitest';
import { localizeHkDiagnostic } from '../../src/admin/housekeeping_errors';

// Representative line per emit site in src/sim/game_config.ts.
const RECOGNIZED = [
  'config: not an object',
  'config: unknown section nonsense',
  'rates: not an object',
  'rates: invalid xpRate',
  'xpTable: must list 20 integers (1..100000000)',
  'mobs: unknown mob ghost',
  'mobs.wolf: override is not an object',
  'mobs.wolf: invalid hpBase',
  'mobs.wolf: minLevel > maxLevel',
  'mobs.wolf: loot must be an array of at most 30 entries',
  'mobs.wolf: loot entry is not an object',
  'mobs.wolf: loot entry needs a chance in 0..1',
  'mobs.wolf: unknown loot itemId nope',
  'mobs.wolf: invalid loot copper',
  'mobs.wolf: unknown loot questId nope',
  'mobs.wolf: invalid loot rollGroup',
  'mobs.wolf: loot entry needs an itemId or copper',
  'quests: unknown quest ghost',
  'quests.q1: invalid retired',
  'quests.q1: objectiveCounts must list 2 integers (1..1000)',
  'items: unknown item ghost',
  'items.sword: stats must be an object',
  'items.sword: unknown stat luck',
  'items.sword: invalid stat str',
  'npcs: unknown npc ghost',
  'npcs.bob: vendorItems must be known item ids (max 40)',
  'npcs.bob: invalid pos',
  'camps: unknown camp index 999',
  'camps.3: override needs the anchoring mobId',
  'camps.3: expected mob wolf but the camp spawns bear (content changed; re-apply from the current list)',
  'camps.3: invalid count',
  'camps.3: invalid center',
];

describe('localizeHkDiagnostic', () => {
  it('recognizes every validation shape (keeps the identifier path prefix)', () => {
    for (const line of RECOGNIZED) {
      const localized = localizeHkDiagnostic(line);
      const path = line.slice(0, line.indexOf(': '));
      expect(localized.startsWith(`${path}: `), line).toBe(true);
      // In English the localized detail is real prose, never a raw t() key.
      expect(localized.includes('hkDiag.'), line).toBe(false);
    }
  });

  it('interpolates the captured tokens', () => {
    expect(localizeHkDiagnostic('mobs: unknown mob ghost')).toBe('mobs: unknown id ghost');
    expect(localizeHkDiagnostic('mobs.wolf: invalid hpBase')).toBe('mobs.wolf: invalid hpBase');
    expect(localizeHkDiagnostic('xpTable: must list 20 integers (1..100000000)')).toBe(
      'xpTable: must list 20 integers (1 to 100000000)',
    );
    expect(
      localizeHkDiagnostic(
        'camps.3: expected mob wolf but the camp spawns bear (content changed; re-apply from the current list)',
      ),
    ).toBe(
      'camps.3: expected mob wolf but the camp spawns bear (content changed; re-apply from the current list)',
    );
  });

  it('falls through unrecognized lines unchanged', () => {
    expect(localizeHkDiagnostic('something entirely different')).toBe(
      'something entirely different',
    );
    expect(localizeHkDiagnostic('mobs.wolf: some future diagnostic')).toBe(
      'mobs.wolf: some future diagnostic',
    );
  });
});
