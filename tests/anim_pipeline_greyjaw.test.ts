// greyjaw's attack. Issue #2889 round 2 gave him a bespoke Greyjaw_Attack, a
// sit-down howl blended into the lunge, shipped from its own mesh-free donor GLB.
// The wolf rig rebuild (scripts/assets/wolf_rig/) dropped it on the art lead's call:
// a wolf that sits down to howl mid-fight reads wrong, so Greyjaw bites like the pack.
// This pins that he plays the pack's own ClipMap (WOLF_BAKED, plain Attack) straight
// from greyjaw.glb, with no donor file to load.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { VISUALS } from '../src/render/characters/manifest';

const ROOT = join(__dirname, '..');

describe('greyjaw attack', () => {
  it("bites like the pack: the pack wolf's own ClipMap, plain Attack", () => {
    expect(VISUALS.greyjaw.clips).toBe(VISUALS.mob_wolf.clips);
    expect(VISUALS.greyjaw.clips.attack).toEqual(['Attack']);
    expect(VISUALS.greyjaw.clips.hit).toEqual(['Idle_HitReact_Left', 'Idle_HitReact_Right']);
  });

  it('loads no donor clip file, and the sit-down howl attack is gone', () => {
    expect(VISUALS.greyjaw.animUrls ?? []).toEqual([]);
    expect(existsSync(join(ROOT, 'public/models/creatures/greyjaw_ability_anims.glb'))).toBe(false);
  });
});
