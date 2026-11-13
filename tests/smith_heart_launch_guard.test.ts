// The Smith's Heart's launch obligations are deferred while the raid is
// dev-gated, and this pin makes the deferral enforced, not just written down
// (docs/design/deeds.md, the Smith's Heart deferral):
//   - while SMITH_HEART_PLAYABLE is false, the raid stays out of the Guide and
//     every deed it owns is HIDDEN (invisible until earned, so no player sees a
//     deed they cannot earn; dev testers who earn one through /dev heart see it);
//   - the change that flips the flag must bring its visible deeds, its real loot
//     (a quest-only drop, the essence quest's remnant, is not loot) and its Guide
//     page in the same change, give the five raid weapon appearances their
//     Reliquary rows and fill the essence coffer's Normal table, or this reds.

import { describe, expect, it } from 'vitest';
import { DEEDS } from '../src/sim/content/deeds';
import { RELIQUARY_HORIZON_WEAPON_SKINS } from '../src/sim/content/reliquary';
import {
  SMITH_HEART_DUNGEON,
  SMITH_HEART_FINAL_BOSS,
  SMITH_HEART_GUARDIANS,
  SMITH_HEART_MOBS,
  SMITH_HEART_PLAYABLE,
} from '../src/sim/content/smith_heart';
import {
  SMITH_HEART_DEED_IDS,
  SMITH_HEART_NORMAL_LOOT_ITEM_IDS,
} from '../src/sim/content/smith_heart_rewards';
import { SMITHS_HEART_WEAPON_SKINS } from '../src/sim/content/weapon_skins';
import { DUNGEONS } from '../src/sim/data';

const raidDeeds = Object.values(DEEDS).filter(
  (d) =>
    JSON.stringify(d).includes(`"${SMITH_HEART_DUNGEON}"`) || SMITH_HEART_DEED_IDS.includes(d.id),
);
const bosses = [...Object.values(SMITH_HEART_GUARDIANS), SMITH_HEART_FINAL_BOSS];

describe("the Smith's Heart launch guard", () => {
  it('names a real raid and its bosses', () => {
    expect(DUNGEONS[SMITH_HEART_DUNGEON]).toBeTruthy();
    for (const id of bosses) expect(SMITH_HEART_MOBS[id], id).toBeTruthy();
  });

  it('every raid deed is one the raid lists (no stray record names the dungeon)', () => {
    expect(raidDeeds.map((d) => d.id).sort()).toEqual([...SMITH_HEART_DEED_IDS].sort());
  });

  it.runIf(!SMITH_HEART_PLAYABLE)(
    'while dev-gated: hidden from the Guide, every deed hidden',
    () => {
      expect(DUNGEONS[SMITH_HEART_DUNGEON].guideVisible).toBe(false);
      for (const d of raidDeeds) expect(d.hidden, d.id).toBe(true);
    },
  );

  it.runIf(SMITH_HEART_PLAYABLE)('once playable: deeds, loot and a Guide page', () => {
    expect(DUNGEONS[SMITH_HEART_DUNGEON].guideVisible).not.toBe(false);
    expect(raidDeeds.length).toBeGreaterThan(0);
    for (const d of raidDeeds) expect(d.hidden, d.id).not.toBe(true);
    for (const id of bosses) {
      const realLoot = (SMITH_HEART_MOBS[id].loot ?? []).filter((l) => !l.questId);
      expect(realLoot.length, id).toBeGreaterThan(0);
    }
    // The essence quest's weekly coffer must have something to give.
    expect(SMITH_HEART_NORMAL_LOOT_ITEM_IDS.length).toBeGreaterThan(0);
    for (const skin of Object.values(SMITHS_HEART_WEAPON_SKINS))
      expect(RELIQUARY_HORIZON_WEAPON_SKINS as readonly string[], skin).toContain(skin);
  });
});
