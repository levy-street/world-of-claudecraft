// Best-judgement simple-collision defaults for freshly placed catalogue
// assets. The voxel bake is a great default for walkable/pass-through
// structures (stairs, arches, framed buildings) but overkill, and often
// lumpy, for solid props: those get a single fitted box, and round/organic
// shapes get a plain radius circle. The decision is data-driven (the baked
// box set itself) with keyword guards for shapes the geometry heuristics
// cannot judge (a gate must stay enterable even when its bake is chunky).

import { analyzeBakedFootprint, collisionOverrideFor } from '../sim/asset_collision';
import { ASSET_RAMPS } from '../sim/asset_collision.generated';
import type { MapHitbox } from '../sim/map_doc';
import { assetById } from './asset_catalog.generated';
import type { AssetPlacement } from './custom_map';

export type DefaultCollisionDecision =
  | { kind: 'baked' } // keep the full voxel bake (placement stays untouched)
  | { kind: 'circle' } // basic mode, auto radius (fitted; follows rescale)
  | { kind: 'square' } // basic mode, yaw-following square footprint
  | { kind: 'none' } // authored: no collision
  | { kind: 'box'; box: MapHitbox }; // one fitted OBB via the hitboxes path

// Assets a player must be able to walk through/into/up: simple footprints
// would seal doorways and stair decks, so the bake always wins here.
const PASS_THROUGH_RE =
  /(arch|gate|door|bridge|stair|ramp|ladder|fence|rail|house|hut|inn$|inn_|cabin|barn|church|chapel|castle|keep|tower|tent|ruin|entrance|dock|scaffold|stall|stand$|gallows|gazebo|pergola|trellis)/;

// Round-ish solids where a circle slides nicer than box corners.
const ROUND_RE =
  /(barrel|pot$|pot_|urn|vase|jar|keg|crystal|rock|boulder|stone|stump|log|mushroom|bush|fern|lamp|torch|brazier|pillar|column|post|statue|fountain|cauldron|bell$|bell_|orb|wheel|well|ore|node|herb|flower|plant)/;

// Trees block by their trunk; the bake already IS trunk-only. A centered
// trunk converts cleanly to a circle, a leaning/off-origin trunk keeps the
// bake (a circle at the placement origin would miss the visual trunk).
const TREE_RE = /(tree|palm|oak|pine|birch|spruce|willow|twisted|dead_\d)/;

// Below this fill ratio the bake is skeletal (posts/frames/openings) and a
// single solid footprint would block space the player can clearly see through.
const MIN_SOLID_COVERAGE = 0.42;
// A trunk this far off-origin (yards, scale 1) no longer matches a circle
// centered on the placement.
const MAX_TRUNK_OFFSET = 0.3;
// Round keyword + XZ aspect under this → circle; elongated shapes stay boxes.
const MAX_ROUND_ASPECT = 1.6;

/** The simple-collision default for a catalogue asset. Non-catalogue ids
 *  (imported models, procedural placements) always keep their own pipeline. */
export function defaultCollisionForAsset(assetId: string): DefaultCollisionDecision {
  if (!assetById(assetId)) return { kind: 'baked' };
  // A Collision Master authored override is the maker's word: it IS the
  // asset's default from then on (heuristics below never run for it).
  const authored = collisionOverrideFor(assetId);
  if (authored) {
    if (authored.mode === 'none') return { kind: 'none' };
    if (authored.mode === 'basic') {
      return authored.shape === 'square' ? { kind: 'square' } : { kind: 'circle' };
    }
    // 'baked': the authored boxes already flow through bakedBoxesForPath.
    return { kind: 'baked' };
  }
  if (ASSET_RAMPS[assetId]) return { kind: 'baked' }; // walkable deck
  const a = analyzeBakedFootprint(assetId);
  // No bake entry: the sim already falls back to a circle, make it explicit
  // so the Selection panel shows the radius controls instead of "baked".
  if (!a) return { kind: 'circle' };
  // An EMPTY bake is deliberate walk-through (stairs decks, ground cover):
  // never replace it with a blocking footprint.
  if (a.boxCount === 0) return { kind: 'baked' };
  const id = assetId.toLowerCase();
  if (PASS_THROUGH_RE.test(id)) return { kind: 'baked' };
  if (a.coverage < MIN_SOLID_COVERAGE) return { kind: 'baked' };
  if (TREE_RE.test(id)) {
    return a.groundOffset <= MAX_TRUNK_OFFSET ? { kind: 'circle' } : { kind: 'baked' };
  }
  if (ROUND_RE.test(id) && a.aspect <= MAX_ROUND_ASPECT) return { kind: 'circle' };
  return { kind: 'box', box: { ...a.union } };
}

/** Stamp a fresh placement with its simple-collision default. No-op when the
 *  placement does not collide or the asset is better served by its bake. */
export function applyDefaultCollision(p: AssetPlacement): void {
  if (!p.collide) return;
  const d = defaultCollisionForAsset(p.assetId);
  if (d.kind === 'circle') {
    p.collisionMode = 'basic';
  } else if (d.kind === 'square') {
    p.collisionMode = 'basic';
    p.collideShape = 'square';
  } else if (d.kind === 'none') {
    p.collisionMode = 'none';
  } else if (d.kind === 'box') {
    // 'baked' + one hand-authored hitbox: the fitted box IS the collision,
    // normalized model space so it follows rescaling, and the existing
    // Edit Hitboxes gizmo can refine it in place.
    p.collisionMode = 'baked';
    p.hitboxes = [{ ...d.box }];
  }
}
