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

/** Largest source dimension (yards) of each Warden bridge module, from its
 *  build sidecar (tmp/asset_src/deepglass/<tag>.collision.json `size`). */
const BRIDGE_KIT_MAX_DIM: Record<string, number> = {
  bridge_deck: 72.21,
  bridge_lamp: 74.85,
  bridge_pylon: 79.22,
};

/** Largest source dimension of each Warden gate state (build sidecar `size`). */
const WARDEN_GATE_MAX_DIM: Record<string, number> = {
  warden_gate_closed: 8.34,
  warden_gate_open: 8.34,
};
/** Largest source dimension of the dock stairs (build sidecar `size`). */
const DOCK_STAIRS_MAX_DIM = 7.58;
/** Largest source dimension of the plot sign (dg_plot_sign.py sidecar `size`). */
const PLOT_SIGN_MAX_DIM = 2.48;
/** Largest source dimension of each dock deck module (build sidecar `size`). */
const DOCK_DECK_MAX_DIM: Record<string, number> = {
  dock_deck: 6.12,
  dock_deck_rail: 6.12,
};

export function targetHeightFor(path: string): number {
  // The loader normalizes by the largest source dimension. This model is already
  // authored at 14 x 11 x 7.2 yards, so preserving its 14-yard width keeps the
  // full sidecar dimensions intact at placement scale 1.
  // The City Build wall tower is authored in real yards (9.6 tall) so its
  // arcade-floor height matches the wall-tower blueprint at placement scale 1;
  // preserve that instead of squashing to TARGET_HEIGHT.
  if (/\/city\/wall_tower\.glb$/i.test(path)) return 9.6;
  // The Deepglass colonnade pillar is Blender-authored at 9 yards with its
  // origin at the foot: keep it, so a placement's scale is height / 9.
  if (/\/props\/deepglass_pillar\.glb$/i.test(path)) return 9;
  // The Warden bridge kit (scripts/assets/deepglass/dg_bridge.py) is authored
  // in yards with the pier feet at the origin: keep each module at its authored
  // size, so scale 1 is an 8 yd square deck on 85 yd piers and the installed
  // collision (install_bridge.mjs, norm 1) lines up with the art.
  const bridge = /\/deepglass\/(bridge_[a-z0-9_]+)\.glb$/i.exec(path);
  if (bridge && BRIDGE_KIT_MAX_DIM[bridge[1]]) return BRIDGE_KIT_MAX_DIM[bridge[1]];
  // The Warden gate (dg_warden_gate.py) is kit-compatible with the 4 yd wall:
  // keep it at the WALL's yards-per-scale (2.2 / 4), so a gate placed at the
  // same scale as a wall run stands its authored 1.6x height with matching
  // courses. Collision installs at that same norm (install_authored.mjs).
  const gate = /\/deepglass\/(warden_gate_[a-z]+)\.glb$/i.exec(path);
  if (gate && WARDEN_GATE_MAX_DIM[gate[1]])
    return WARDEN_GATE_MAX_DIM[gate[1]] * (TARGET_HEIGHT / 4);
  // Dock stairs (dg_dock_stairs.py): authored in yards, scale 1 = as built.
  if (/\/props\/dock_stairs\.glb$/i.test(path)) return DOCK_STAIRS_MAX_DIM;
  // Plot sign (dg_plot_sign.py): authored yards, post foot at the origin; scale 1 = 2.58 yd tall.
  if (/\/props\/plot_sign\.glb$/i.test(path)) return PLOT_SIGN_MAX_DIM;
  // Dock deck modules (dg_dock_deck.py): authored yards, deck at the stairs' landing.
  const deck = /\/props\/(dock_deck(?:_rail)?)\.glb$/i.exec(path);
  if (deck && DOCK_DECK_MAX_DIM[deck[1]]) return DOCK_DECK_MAX_DIM[deck[1]];
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
