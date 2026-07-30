// Guard: a level-20 armored body renders at EXACTLY its base body's size.
//
// The toggle swaps one model for another on a live character, so any size or
// grounding difference reads as the character growing, shrinking or floating when
// you press it. Sharing `def.height` does not give that for free: height is a
// normalization TARGET for each model's own MEASURED posed bounds
// (`normScale = def.height / rawHeight`), so a helm crest or a robe hem moves
// rawHeight and rescales the whole rig. The armored defs therefore set
// `normalizeFrom` and inherit the base body's normScale and yOffset outright.
//
// Asserting "the armored def inherits height" or "the rendered height is 2.6" would
// NOT catch this: both were already true while the rigs were mis-scaled.
import { beforeAll, describe, expect, it } from 'vitest';
import { ALL_CLASSES } from '../src/sim/types';

// prepareVisual needs the GLTF preload registry, which only exists in the browser
// bundle. The manifest itself is three-free data, so the def-level contract (every
// armored def points normalizeFrom at its base key) is what a Node test can pin,
// and it is the whole mechanism: prepareVisual has no other input for the two
// numbers that decide rendered size.
let VISUALS: typeof import('../src/render/characters/manifest')['VISUALS'];
let hasArmoredBody: typeof import('../src/render/characters/manifest')['hasArmoredBody'];
let mechVisualKeys: typeof import('../src/render/characters/manifest')['mechVisualKeys'];

beforeAll(async () => {
  const manifest = await import('../src/render/characters/manifest');
  VISUALS = manifest.VISUALS;
  hasArmoredBody = manifest.hasArmoredBody;
  mechVisualKeys = manifest.mechVisualKeys;
});

describe('armored body size', () => {
  it('normalizes from the base body, not from its own bounds', () => {
    const armored = ALL_CLASSES.filter((cls) => hasArmoredBody(cls));
    expect(armored.length).toBe(ALL_CLASSES.length);

    for (const cls of armored) {
      const def = VISUALS[`player_${cls}_armored`];
      const baseKey = `player_${cls}`;

      // Without this, normScale is derived from the ARMOR's measured height and the
      // character visibly changes size when the toggle is pressed.
      expect(def.normalizeFrom, cls).toBe(baseKey);
      // The inherited key must exist, or prepareVisual would recurse into undefined.
      expect(VISUALS[baseKey], cls).toBeDefined();
      // Self-reference would be an infinite recursion in prepareVisual.
      expect(def.normalizeFrom, cls).not.toBe(`player_${cls}_armored`);
      // height still has to agree, since it feeds the click proxy, the nameplate
      // anchor and the far-mesh lift independently of normScale.
      expect(def.height, cls).toBe(VISUALS[baseKey].height);
      expect(def.hover, cls).toBe(VISUALS[baseKey].hover);
    }
  });

  it('leaves the Combat Mech deriving its own normalization', () => {
    // The mech is a deliberately different-sized KayKit model, not a same-size
    // swap, so it must NOT inherit a class body's scale.
    expect(VISUALS.player_mech.normalizeFrom).toBeUndefined();
  });

  it('sets normalizeFrom on no other visual', () => {
    const users = Object.entries(VISUALS)
      .filter(([, def]) => def.normalizeFrom !== undefined)
      .map(([key]) => key)
      .sort();

    // The armored bodies plus every re-forged per-class mech suit (both are
    // live same-size swaps on the class rig); the legacy shared mech is not one.
    const mechSuits = mechVisualKeys().filter((key) => key !== 'player_mech');
    expect(users).toEqual(
      [...ALL_CLASSES.map((cls) => `player_${cls}_armored`), ...mechSuits].sort(),
    );
  });
});

describe('per-class mech suit bodies', () => {
  it('every class ships a suit; suits follow the armored-body contract', () => {
    const suits = mechVisualKeys().filter((key) => key !== 'player_mech');
    expect(suits.sort()).toEqual(ALL_CLASSES.map((cls) => `player_${cls}_mech`).sort());

    for (const key of suits) {
      const def = VISUALS[key];
      const baseKey = key.replace(/_mech$/, '');
      expect(VISUALS[baseKey], key).toBeDefined();
      // Same live-swap size contract as the armored bodies: /dev mech must not
      // grow, shrink or float the character.
      expect(def.normalizeFrom, key).toBe(baseKey);
      expect(def.height, key).toBe(VISUALS[baseKey].height);
      // No clips of its own: the suit binds the base body's clips by name.
      expect(def.animUrls, key).toContain(VISUALS[baseKey].url);
      // Fully enclosing suit: no head cosmetics and no head graft.
      expect(def.cosmetics, key).toBeUndefined();
      expect(def.graftUrl, key).toBeUndefined();
      // Mech-family loading: out of the boot sweep, warmed by preloadMechAssets.
      expect(def.lazyPreload, key).toBe(true);
      // Holds the wearer's weapons exactly like the base body.
      expect(def.weaponSlots, key).toEqual(VISUALS[baseKey].weaponSlots);
      expect(def.offhandSlot, key).toBe(VISUALS[baseKey].offhandSlot);
    }
  });
});
