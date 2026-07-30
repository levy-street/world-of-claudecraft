// Guard: player bodies render 20% taller than a stock humanoid, and ONLY player
// bodies do.
//
// `PLAYER_H` exists so the nine class rigs read as heroic next to the townsfolk.
// The scope is the whole point: the class bodies share their rig, their clip set
// and (until this split) their height constant with the humanoid NPCs and trash
// mobs, so the obvious edit -- bumping HUMANOID_H itself -- silently scales half
// the world's cast. This pins the split so a later "simplification" back onto one
// constant fails loudly instead of growing every villager.
//
// Asserting "player height is 3.12" alone would NOT catch that: it stays true when
// the mobs grow too. The ratio against a named NPC is what makes it decisive.
import { beforeAll, describe, expect, it } from 'vitest';
import { ALL_CLASSES } from '../src/sim/types';

/** The values the constants resolve to, pinned as literals. A self-comparison
 *  against the manifest's own arithmetic would pass no matter what it said. */
const STOCK_HUMANOID_H = 2.6;
const PLAYER_H = 3.12;

/** Humanoid NPCs and mobs that share the class rig and must NOT have grown.
 *  Named individually rather than derived, so deleting one is a visible edit. */
const STOCK_HUMANOIDS = [
  'npc_villager',
  'npc_knight',
  'npc_smith',
  'npc_scout',
  'mob_bandit',
  'mob_bruiser',
  'mob_dark_caster',
] as const;

let VISUALS: typeof import('../src/render/characters/manifest')['VISUALS'];

beforeAll(async () => {
  VISUALS = (await import('../src/render/characters/manifest')).VISUALS;
});

describe('player body scale', () => {
  it('renders every class body 20% taller than a stock humanoid', () => {
    for (const cls of ALL_CLASSES) {
      const def = VISUALS[`player_${cls}`];
      expect(def, cls).toBeDefined();
      expect(def.height, cls).toBeCloseTo(PLAYER_H, 10);
      // The ratio, not just the absolute: this is the assertion that fails if
      // someone scales the shared HUMANOID_H instead of the player-only knob.
      expect(def.height / STOCK_HUMANOID_H, cls).toBeCloseTo(1.2, 10);
    }
  });

  it('scales the Combat Mech and the level-20 armored bodies with them', () => {
    // The mech is a cosmetic body a live player wears, so a player who equips it
    // must not visibly shrink. Same for the armored sets, which additionally
    // inherit normScale via normalizeFrom (see armored_visual_size.test.ts).
    expect(VISUALS.player_mech.height).toBeCloseTo(PLAYER_H, 10);
    for (const cls of ALL_CLASSES) {
      expect(VISUALS[`player_${cls}_armored`].height, cls).toBeCloseTo(PLAYER_H, 10);
    }
  });

  it('leaves every humanoid NPC and mob at the stock height', () => {
    for (const key of STOCK_HUMANOIDS) {
      const def = VISUALS[key];
      expect(def, key).toBeDefined();
      expect(def.height, key).toBeCloseTo(STOCK_HUMANOID_H, 10);
    }
  });

  it('grows no non-player visual, not even a derived one', () => {
    // mob_yumi_cat is the trap: a static quest objective sized as HUMANOID_H * 1.2,
    // i.e. "20% over a player head" back when a player was HUMANOID_H. Re-pointing
    // it at PLAYER_H to keep that comment true would have grown a mob, which is
    // exactly the scope creep this file exists to prevent. It stays at 3.12.
    expect(VISUALS.mob_yumi_cat.height).toBeCloseTo(STOCK_HUMANOID_H * 1.2, 10);

    // The whole cast, stated as a set: exactly which visuals sit at PLAYER_H. A
    // villager, bandit or boss appearing here means a shared constant grew and
    // dragged the world's cast up with the players.
    const atPlayerHeight = Object.entries(VISUALS)
      .filter(([, def]) => Math.abs(def.height - PLAYER_H) < 1e-9)
      .map(([key]) => key)
      .sort();
    const expected = [
      ...ALL_CLASSES.map((cls) => `player_${cls}`),
      ...ALL_CLASSES.map((cls) => `player_${cls}_armored`),
      // The per-class Combat Mech suits are cosmetic swaps of the class body,
      // so they inherit its height exactly (normalizeFrom, pinned in
      // armored_visual_size.test.ts) and belong in this set for the same
      // reason the armored bodies do.
      ...ALL_CLASSES.map((cls) => `player_${cls}_mech`),
      'player_mech',
      // Not a player body: HUMANOID_H * 1.2 is the SAME float as PLAYER_H, so the
      // objective cat lands in this set without having changed by a single unit.
      // Listed rather than filtered out, because silently excusing a mob is how the
      // next one gets excused too.
      'mob_yumi_cat',
    ].sort();

    expect(atPlayerHeight).toEqual(expected);
  });
});
