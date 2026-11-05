// The Smith's Heart never grows the iOS post-entry creature stream:
//   - its own body (the Masterless Strength) loads behind the raid's arrival
//     cover (the on-demand lane), like the other interiors' bodies;
//   - its borrowed placeholder looks never pull a Rift-lane body (the Buried
//     Hoard's) out of its lane.

import { describe, expect, it } from 'vitest';
import {
  characterPreloadUrls,
  mobVisualKeyFor,
  VISUALS,
  weaponSkinModelUrls,
} from '../src/render/characters/manifest';
import {
  characterStreamPlan,
  dungeonCharacterBodyUrls,
} from '../src/render/characters/rift_body_stream_core';
import { MASTERLESS_STRENGTH_URL } from '../src/render/characters/smith_heart_boss_looks';
import { SMITH_HEART_MOBS } from '../src/sim/content/smith_heart';

const ios = characterStreamPlan(characterPreloadUrls(false), new Set(weaponSkinModelUrls()), true);

describe("the Smith's Heart and the iOS entry stream", () => {
  it("loads the final boss's body at the raid's arrival, not at entry", () => {
    expect(dungeonCharacterBodyUrls('smith_heart')).toContain(MASTERLESS_STRENGTH_URL);
    expect(ios.onDemand).toContain(MASTERLESS_STRENGTH_URL);
    expect(ios.postEntry).not.toContain(MASTERLESS_STRENGTH_URL);
  });

  it('borrows no Rift-lane body for a placeholder look', () => {
    const lanes = new Set([...ios.rift, ...ios.hoard]);
    expect(lanes.size).toBeGreaterThan(0);
    for (const id of Object.keys(SMITH_HEART_MOBS)) {
      const def = VISUALS[mobVisualKeyFor(id)];
      expect(def, id).toBeTruthy();
      expect(def.url.includes('/hoard_'), `${id} wears ${def.url}`).toBe(false);
    }
  });
});
