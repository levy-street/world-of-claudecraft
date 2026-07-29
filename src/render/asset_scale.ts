// The one normalization rule for placed catalogue GLBs: what world height a
// model lands at before its per-placement scale.
//
// This is the map editor's rule, and it is load-bearing for collision: the
// editor's collision bake normalizes with EXACTLY these numbers, so the baked
// boxes vendored into data/battleground/thornhollow_assets.json only line up
// with their models when the renderer seats them the same way. Changing a
// number here silently drifts every authored map's colliders off its art.

// Height (yards) a placed model is normalized to before its per-placement
// scale, so arbitrary catalogue GLBs (which vary wildly in source units) land
// sanely.
export const TARGET_HEIGHT = 2.2;

// Catalogue foliage lands at believable WORLD sizes instead of the generic
// prop height: a tree normalized to 2.2yd is doll-sized next to the ~2yd
// player, which made every brushed tree/bush read far too small no matter
// what the scale sliders said. Per-placement scale still multiplies on top,
// and the collide-radius factors are tuned against these same heights so the
// blocking circle keeps tracking the visual silhouette.
export function targetHeightFor(path: string): number {
  // The loader normalizes by the largest source dimension. This model is already
  // authored at 14 x 11 x 7.2 yards, so preserving its 14-yard width keeps the
  // full sidecar dimensions intact at placement scale 1.
  if (/goldcrest_bank_reference/i.test(path)) return 14;
  // The City Build wall tower is authored in real yards (9.6 tall) so its
  // arcade-floor height matches the wall-tower blueprint at placement scale 1;
  // preserve that instead of squashing to TARGET_HEIGHT.
  if (/\/city\/wall_tower\.glb$/i.test(path)) return 9.6;
  // Palms live in the biome set but are trees: match them wherever they sit.
  if (/beach_palm/i.test(path)) return 4;
  if (/desert_cactus_tall/i.test(path)) return 4.5;
  const m = /\/foliage\/([a-z0-9_]+)\.glb$/i.exec(path);
  if (!m) return TARGET_HEIGHT;
  const name = m[1];
  if (/^(oak|pine|twisted|dead)/.test(name)) return 7.5;
  if (/^bush/.test(name)) return 3.2;
  if (/^(fern|mushroom)/.test(name)) return 1.6;
  if (/^rock/.test(name)) return 2.4;
  return TARGET_HEIGHT;
}
