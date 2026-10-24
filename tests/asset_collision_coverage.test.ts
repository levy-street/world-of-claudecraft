// Every placeable catalogue asset must resolve to SOME collision decision.
//
// The gap this pins: `medieval_village_v2` (349 assets, the whole village
// pack: buildings, props, nature, environment) shipped with no baked collision
// at all, so every house a maker placed blocked as a fat legacy circle instead
// of its walls. It was never excluded on purpose; the bake generator simply
// stopped being re-run after the packs landed, and nothing noticed because
// nothing asserted coverage. Re-run it with:
//
//   node scripts/assets/bake_collision.mjs
//
// An asset is covered when it has a voxel bake, a Collision Master override,
// or an explicit 'none' bake category (ground cover, which keeps the soft
// circle on purpose, a bush should not have walls).

import { describe, expect, it } from 'vitest';
import { ASSET_CATALOG } from '../src/editor/asset_catalog.generated';
import { bakeCategoryFor } from '../src/editor/collision_bake_core';
import { collisionOverrideFor } from '../src/sim/asset_collision';
import { ASSET_COLLISION, ASSET_RAMPS } from '../src/sim/asset_collision.generated';

/** Assets with no geometry to bake: animation-only GLBs that ride the
 *  catalogue because they live under public/models. They are clip libraries
 *  retargeted onto a rig, so there is nothing to collide with, the naming
 *  convention ('..._anim' / '..._anims', or '..._clips' for a clip donor whose
 *  clips replace a body's by name) is the whole tell. */
const NO_GEOMETRY_IDS = new Set([
  // The WOC body clip libraries and the Laverock's locomotion clips are named
  // by body, not by the suffix, and the keyed WOC rigs carry only skinned
  // meshes: the bake reads no static triangles from any of them and skips them.
  'chars/players/woc/anims_female',
  'chars/players/woc/anims_male',
  'chars/players/woc_keyed/woc_female',
  'chars/players/woc_keyed/woc_male',
  'creatures/temple_laverock_locomotion',
]);
const NO_GEOMETRY = (id: string): boolean => /_(anims?|clips)$/.test(id) || NO_GEOMETRY_IDS.has(id);

describe('catalogue collision coverage', () => {
  it('leaves no placeable asset without a collision decision', () => {
    const uncovered = ASSET_CATALOG.filter((a) => {
      if (NO_GEOMETRY(a.id)) return false;
      if (bakeCategoryFor(a.id) === 'none') return false; // deliberate soft circle
      if (ASSET_COLLISION[a.id] !== undefined) return false;
      if (ASSET_RAMPS[a.id] !== undefined) return false;
      return collisionOverrideFor(a.id) === null;
    }).map((a) => a.id);
    expect(uncovered, `re-run scripts/assets/bake_collision.mjs:\n${uncovered.join('\n')}`).toEqual(
      [],
    );
  });

  it('covers the village pack that the gap was found in', () => {
    const village = ASSET_CATALOG.filter((a) => a.category === 'medieval_village_v2');
    expect(village.length).toBeGreaterThan(300);
    const baked = village.filter((a) => ASSET_COLLISION[a.id] !== undefined);
    expect(baked).toHaveLength(village.length);
  });

  it('still leaves ground cover as a soft circle', () => {
    // The one class that must NOT gain hugging boxes: walking through a fern
    // should brush past it, and a bush with walls reads as a bug.
    for (const id of ['foliage/bush', 'foliage/fern', 'foliage/mushroom']) {
      expect(bakeCategoryFor(id)).toBe('none');
      expect(ASSET_COLLISION[id]).toBeUndefined();
    }
  });

  it('bakes trees as trunks, not canopies', () => {
    expect(bakeCategoryFor('foliage/oak_1')).toBe('trunk');
    expect(bakeCategoryFor('foliage/pine_1')).toBe('trunk');
  });
});
