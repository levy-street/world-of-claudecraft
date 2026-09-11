// Subtle foliage motion, scoped to the player's immediate surroundings.
//
// Two terms, both in the vertex shader, both gated on distance to the player:
//
//   LEAN    a slow whole-plant tilt on a dual-sine (half the frequency of the
//           canopy wind in foliage.ts, a trunk moves slower than its leaves),
//           weighted quadratically up the plant's own height so roots stay
//           planted and the crown carries the motion.
//   SHIMMER a faster, small, FIXED-WORLD-SIZE flutter for leaf materials only,
//           weighted linearly up the height. This is what makes a bush read as
//           leafy rather than as a rocking solid; bark keeps lean alone.
//
// Amplitude eases in as the player approaches and is exactly zero otherwise,
// so the far field costs nothing visually and the effect reads as "the air is
// alive right here". Applied to BOTH render paths: placed tree/bush/palm GLBs
// (placed_assets.ts, the animation ships built into the asset, wherever it is
// placed) and the procedural pines/oaks (foliage.ts). Player gating happens
// in-shader off the plant's WORLD base position, so globally shared materials
// (the glTF template cache, the name-keyed foliage material cache, the
// Palmreach strand's instanced palms) all ride one program and simply rest
// when nobody is close.
//
// COST: no per-frame JS, no extra draw calls, no extra materials or programs, // one vec2 uniform written once per frame and a handful of ALU ops per vertex
// on programs that were being compiled anyway. Shadow/depth passes and
// impostors deliberately do not sway (existing canopy-wind precedent), so the
// shadow map never redraws because a leaf moved.

import * as THREE from 'three';

// Player world position, written once per frame from Renderer.sync (the
// editor viewport teleports its frozen sim player to the camera target every
// frame, so the effect previews under the editor camera too). Starts far away
// so nothing sways before the first sync.
export const treeSwayUniforms = {
  uSwayPlayer: { value: new THREE.Vector2(1e6, 1e6) },
};

export function updateTreeSwayPlayer(x: number, z: number): void {
  treeSwayUniforms.uSwayPlayer.value.set(x, z);
}

// Amplitude eases in between these player distances (yards): full sway across
// the whole visible foreground, easing to rest in the middle distance.
const NEAR_FULL = 70;
const NEAR_OFF = 130;
const f = (n: number): string => n.toFixed(4);

/**
 * GLSL block computing `wocSwayWave` (signed sway offset base, no height
 * weight yet) from a world-space base position `wocSwayBase` that the CALLER
 * must have declared as a vec2. Callers then displace `transformed` by
 * `wocSwayWave * <heightWeight>`.
 *
 * Also leaves `wocSwayGate` and `wocSwayPh` in scope for callers that layer a
 * second term (the leaf shimmer below) on the same gate and phase.
 */
export function treeSwayWaveGlsl(): string {
  return `
    float wocSwayGate =
      1.0 - smoothstep(${f(NEAR_FULL)}, ${f(NEAR_OFF)}, distance(wocSwayBase, uSwayPlayer));
    float wocSwayPh = wocSwayBase.x * 0.15 + wocSwayBase.y * 0.17;
    // A slow gust rolling across the grove (travelling along +X+Z, ~27s to
    // cross 100 yards) swells and eases the amplitude between 0.55 and 1.0.
    // Without it every plant leans on a fixed-amplitude metronome, which is
    // what makes cheap sway read as mechanical.
    float wocGust = 0.775 + 0.225 * sin(uTime * 0.23 - (wocSwayBase.x + wocSwayBase.y) * 0.021);
    float wocSwayWave = (sin(uTime * 0.9 + wocSwayPh) + 0.5 * sin(uTime * 1.7 + wocSwayPh * 1.3))
      * wocSwayGate * wocGust;
  `;
}

/**
 * GLSL for the leaf shimmer, layered on top of `treeSwayWaveGlsl()` (which
 * must already be in scope for `wocSwayGate` / `wocSwayPh`). Leaves
 * `wocLeafWave` in scope: a signed offset already in the caller's LOCAL units.
 *
 * `worldScaleExpr` is a GLSL float expression giving the object's world Y
 * scale. Shimmer is a fixed physical size (a leaf flutters a couple of inches
 * whether it hangs on a sapling or a great oak), so it is authored in yards
 * and divided back into local units here, unlike the lean, which is a
 * fraction of the plant's own height and therefore scale-free.
 */
export function treeSwayLeafGlsl(strength: number, worldScaleExpr: string): string {
  return `
    float wocLeafWave = (sin(uTime * 1.9 + wocSwayPh * 1.7) + 0.5 * sin(uTime * 3.3 + wocSwayPh))
      * wocSwayGate * ${f(strength)} / max(0.0001, ${worldScaleExpr});
  `;
}

/** Peak world-space leaf flutter, in yards, at full leaf strength. Matched to
 *  foliage.ts's canopy wind (TREE_WIND_STRENGTH 0.06 x the 1.5 dual-sine peak)
 *  so a placed oak and a procedural oak standing side by side move alike. */
export const LEAF_SHIMMER_YARDS = 0.075;

/** Whole-plant lean at the crown, as a fraction of the plant's own height. A
 *  bush leans far more of its own height than a tree does: it is a springy
 *  ball of twigs, not a column of timber, and at 3.8% a knee-high shrub would
 *  move about a centimetre and read as dead. */
export const LEAN_FRACTION = { tree: 0.038, bush: 0.11 } as const;

/** Shimmer multiplier by plant kind: undergrowth rustles harder than a canopy
 *  twelve yards up, and it is right next to the camera where it shows. */
export const LEAF_KIND_MUL = { tree: 1, bush: 1.35 } as const;

export type SwayKind = keyof typeof LEAN_FRACTION;

// Assets the MAKER has turned sway off for (MapDoc.assetSway, projected onto
// WorldContent.assetSway). Sway is on by default, so this holds only the
// opt-outs: the vines that should hang dead still, a hedge standing in for a
// wall, a prop whose leafy name fooled the heuristic below.
//
// Keyed by catalogue asset id ('nature/Ivy_01'), with the raw path accepted too
// so imported models ('local/<sha>') can be switched off the same way. It gates
// swayKindForAssetPath rather than the shader, so a disabled asset compiles no
// sway program at all instead of running one multiplied by zero.
let swayOffAssets: ReadonlySet<string> = new Set();

/** Replace the set of assets with sway turned off. Callers pass asset ids
 *  and/or model paths; both resolve. Templates already built keep their
 *  compiled program, so the caller reloads affected placements (the editor
 *  drops the template and rebuilds; a playtest sets this before anything
 *  loads). */
export function setSwayDisabledAssets(ids: Iterable<string>): void {
  swayOffAssets = new Set(ids);
}

/** Whether the maker turned sway off for this model path. */
export function swayDisabledForPath(path: string): boolean {
  if (swayOffAssets.has(path)) return true;
  const m = /^\/models\/(.+)\.glb$/.exec(path);
  return m ? swayOffAssets.has(m[1]) : false;
}

// Rigid things whose names happen to contain a leafy word (a stone flower
// planter, a mushroom, the hex grass TILE, a shrine carved with reeds). Checked
// first, so the generic heuristic below can stay generous.
const RIGID_ASSET =
  /rock|stone|boulder|cliff|mushroom|hex_tile|flowerpot|shrine|statue|pillar|anvil|forge|furnace|wagon|cart|crate|barrel|fence|log_|stump/i;

// Low, leafy things that should rock as a whole and flutter hard: the shrubs,
// ferns, ground plants, ivy, vines, reeds and flowers.
const BUSH_ASSET =
  /bush|shrub|fern|ivy|vine|reed|hedge|sapling|grass|flower|plant|leaf|leaves|frond/i;

// Anything with a trunk: the foliage kit's oaks/pines/twisted/dead trees, the
// beach palms, the dungeon pines, the village trees, the desert tree, and any
// imported model that calls itself one.
const TREE_ASSET = /tree|palm|oak|pine|twisted|birch|willow|cedar|spruce|cypress/i;

/**
 * How a placed-asset GLB should sway, or null when it should stay rigid.
 *
 * Path-keyed rather than a fixed list so imported and maker-authored models
 * get the effect too: an asset named `my_big_tree.glb` sways without anyone
 * editing this file. `foliage/dead_*` counts as a tree, a bare dead trunk
 * still leans in wind, and with no leaf materials it gets no shimmer anyway.
 */
export function swayKindForAssetPath(path: string): SwayKind | null {
  if (swayOffAssets.size > 0 && swayDisabledForPath(path)) return null;
  return naturalSwayKindForAssetPath(path);
}

/**
 * How this asset would move in wind IGNORING the maker's opt-out, the shape
 * of the thing, not its current setting.
 *
 * This is the question the editor's sway checkbox asks. Asking the gated
 * function above instead is the bug that shipped first: turning sway off made
 * it answer null, the inspector read that as "this asset is rigid", and the
 * checkbox vanished, so it could never be turned back on.
 */
export function naturalSwayKindForAssetPath(path: string): SwayKind | null {
  if (RIGID_ASSET.test(path)) return null;
  if (BUSH_ASSET.test(path)) return 'bush';
  if (TREE_ASSET.test(path)) return 'tree';
  // The foliage kit's dead trunks are named `dead_1.glb` etc. with no other
  // hint in the path.
  if (/\/models\/foliage\//.test(path)) return 'tree';
  return null;
}

/**
 * Leaf-shimmer multiplier for a GLB material, keyed off the source material
 * NAME. The shipped foliage kit names its materials `Leaves*` / `Bark*` /
 * `Flowers` / `Rocks` (the same names foliage.ts's MAT_POLICY keys off), so a
 * placed oak's trunk stays stiff while its canopy flutters, exactly as the
 * procedural path does. Unknown names, imported models, the village kit, get
 * a middling value: enough life to read, not enough to look liquid if the
 * material turns out to be a trunk.
 */
export function leafStrengthForMaterialName(name: string): number {
  if (/^bark|trunk|wood|stem/i.test(name)) return 0;
  if (/^rocks?$|^stone|^mushroom|^dirt|^ground/i.test(name)) return 0;
  if (/leaf|leaves|flower|foliage|frond|petal|grass/i.test(name)) return 1;
  return 0.6;
}
