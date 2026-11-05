// The Smith's Heart's launch obligations are deferred while the raid is
// dev-gated, and this pin makes the deferral enforced, not just written down
// (docs/design/deeds.md, the Smith's Heart deferral):
//   - while SMITH_HEART_PLAYABLE is false, the raid stays out of the Guide and
//     carries no deed (no player could earn it);
//   - the change that flips the flag must bring its deeds, its loot and its
//     Guide page in the same change, or this reds.

import { describe, expect, it } from 'vitest';
import { DEEDS } from '../src/sim/content/deeds';
import {
  SMITH_HEART_DUNGEON,
  SMITH_HEART_FINAL_BOSS,
  SMITH_HEART_GUARDIANS,
  SMITH_HEART_MOBS,
  SMITH_HEART_PLAYABLE,
} from '../src/sim/content/smith_heart';
import { DUNGEONS } from '../src/sim/data';

const raidDeeds = Object.values(DEEDS).filter((d) =>
  JSON.stringify(d).includes(`"${SMITH_HEART_DUNGEON}"`),
);
const bosses = [...Object.values(SMITH_HEART_GUARDIANS), SMITH_HEART_FINAL_BOSS];

describe("the Smith's Heart launch guard", () => {
  it('names a real raid and its bosses', () => {
    expect(DUNGEONS[SMITH_HEART_DUNGEON]).toBeTruthy();
    for (const id of bosses) expect(SMITH_HEART_MOBS[id], id).toBeTruthy();
  });

  it.runIf(!SMITH_HEART_PLAYABLE)('while dev-gated: hidden from the Guide, no deeds', () => {
    expect(DUNGEONS[SMITH_HEART_DUNGEON].guideVisible).toBe(false);
    expect(raidDeeds).toEqual([]);
  });

  it.runIf(SMITH_HEART_PLAYABLE)('once playable: deeds, loot and a Guide page', () => {
    expect(DUNGEONS[SMITH_HEART_DUNGEON].guideVisible).not.toBe(false);
    expect(raidDeeds.length).toBeGreaterThan(0);
    for (const id of bosses) expect(SMITH_HEART_MOBS[id].loot?.length ?? 0, id).toBeGreaterThan(0);
  });
});
