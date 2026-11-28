// The raid atlas's shared marks as pure decisions
// (src/ui/hud/raid_atlas/raid_atlas_shared_marks_core.ts): the wire page index
// to atlas floor mapping, the edit right the chrome shows (the sim's own rule),
// the hit test and the paint key. The sim and wire behavior live in
// tests/shared_map_marks.test.ts and tests/shared_map_marks_wire.test.ts.

import { describe, expect, it } from 'vitest';
import { raidAtlasPlanFor } from '../src/ui/hud/raid_atlas/raid_atlas_plan_core';
import {
  RAID_ATLAS_SHARED_SYMBOLS,
  sharedMarkAtScreen,
  sharedMarkPage,
  sharedMarksEditable,
  sharedMarksKey,
  sharedMarksOnAtlas,
} from '../src/ui/hud/raid_atlas/raid_atlas_shared_marks_core';

const plan = raidAtlasPlanFor('smith_heart');
if (!plan) throw new Error('the Smith Heart has an atlas');

describe('raid atlas shared marks core', () => {
  it('maps the wire page to the plan floors and back', () => {
    expect(plan.floors.map((f) => f.id)).toEqual(['veins', 'heart']);
    expect(sharedMarkPage(plan, 'veins')).toBe(0);
    expect(sharedMarkPage(plan, 'heart')).toBe(1);
    expect(
      sharedMarksOnAtlas(plan, [
        { symbol: 7, page: 1, x: 3, z: 4, wx: 0, y: 0, wz: 0 },
        { symbol: 0, page: 0, x: -1, z: 2, wx: 0, y: 0, wz: 0 },
        { symbol: 2, page: 3, x: 0, z: 0, wx: 0, y: 0, wz: 0 }, // a page this plan does not have
      ]),
    ).toEqual([
      { symbol: 7, floor: 'heart', x: 3, z: 4 },
      { symbol: 0, floor: 'veins', x: -1, z: 2 },
    ]);
  });

  it('shows the edit tools solo, in a party, and to a raid leader only', () => {
    expect(sharedMarksEditable(null, 4)).toBe(true);
    expect(sharedMarksEditable({ leader: 1, raid: false }, 4)).toBe(true);
    expect(sharedMarksEditable({ leader: 4, raid: true }, 4)).toBe(true);
    expect(sharedMarksEditable({ leader: 1, raid: true }, 4)).toBe(false);
  });

  it('offers the eight raid-marker symbols, star to skull', () => {
    expect([...RAID_ATLAS_SHARED_SYMBOLS]).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('finds the topmost mark under a point on the open floor only', () => {
    const marks = [
      { symbol: 1, floor: 'veins' as const, x: 0, z: 0 },
      { symbol: 2, floor: 'veins' as const, x: 1, z: 0 },
      { symbol: 3, floor: 'heart' as const, x: 0, z: 0 },
    ];
    const project = (x: number, z: number) => ({ sx: 100 + x * 10, sy: 100 + z * 10 });
    expect(sharedMarkAtScreen(marks, 'veins', project, 104, 100, 8)?.symbol).toBe(2);
    expect(sharedMarkAtScreen(marks, 'veins', project, 99, 100, 3)?.symbol).toBe(1);
    expect(sharedMarkAtScreen(marks, 'heart', project, 100, 100, 3)?.symbol).toBe(3);
    expect(sharedMarkAtScreen(marks, 'veins', project, 150, 150, 8)).toBeNull();
  });

  it('keys a paint on every mark that moves, appears or goes', () => {
    const a = [{ symbol: 7, floor: 'veins' as const, x: 1, z: 2 }];
    const k = sharedMarksKey(a);
    expect(sharedMarksKey([{ ...a[0], x: 1.1 }])).not.toBe(k);
    expect(sharedMarksKey([{ ...a[0], floor: 'heart' }])).not.toBe(k);
    expect(sharedMarksKey([{ ...a[0], symbol: 6 }])).not.toBe(k);
    expect(sharedMarksKey([])).not.toBe(k);
    expect(sharedMarksKey([...a])).toBe(k);
  });
});
