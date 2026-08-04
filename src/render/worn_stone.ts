// Shared triplanar surface-detail layer for the flat-palette 3D asset
// families. Their GLB UVs point at solid palette cells or thin gradient
// strips, so per-mesh detail texturing has nothing to work with; instead the
// layer samples a real CC0 PBR set per MATERIAL FAMILY with a WORLD-SPACE
// (or, for held weapons, object-space) triplanar projection and composes it
// over whatever the material already does:
// - the shading normal bends toward the family's detail normal (subtle by
//   default, so the beveled low-poly silhouette survives),
// - diffuse multiplies by the AO map remapped into a family band (grime
//   settles in mortar lines / plank seams while raised faces lighten a touch,
//   so the surface reads worn rather than just dirty),
// - roughness lerps partway toward the set's roughness map,
// - on ULTRA and above, a multi-tap parallax (3 taps on ultra, 4 on insane;
//   also available through the Advanced Surface Detail dial) walks the
//   projection along the view ray using the family's
//   Displacement map (per-family amplitude and clamp: deep on stone/rock/
//   bark, shallow on plaster/fabric) so surfaces gain clearly per-pixel
//   height response against both the light AND the camera, and the sampled
//   height also shades the diffuse (recesses darken, crests lighten) so the
//   relief reads even head-on.
// Seven families (stone: Bricks076A dressed masonry, rock: Rock026 natural
// geological fracture, wood: MedievalWood, plaster: Plaster007, bark: Bark012,
// fabric: Fabric030, metal: Metal013 with a real Metalness map), shared
// textures loaded once; zero per-frame work; the Lambert (low) tier is
// skipped entirely. The fragment cost is distance-graded: near-axis surfaces
// collapse to single-plane sampling, the parallax walk fades out where its
// offset drops sub-pixel, and the whole detail layer eases to its measured
// mip-mean constants where distance has averaged the maps flat (the fade
// blocks below), so a distant facade costs no taps at all. The
// stone/rock split matters: masonry carries running-bond mortar lines that
// look absurd on a boulder, so anything geological routes to rock. The layer
// must stay SUBTLE: the game's look is cozy low-poly, the detail suggests
// material, never photoreal.
import type * as THREE from 'three';
import { loadTexture } from './assets/loader';
import { registerDeferredPreload } from './assets/preload';
import { GFX, type SurfaceMatOpts, surfaceMat } from './gfx';
import { renderLayerDisabled } from './render_dev_flags';

export type SurfaceFamily = 'stone' | 'rock' | 'wood' | 'plaster' | 'bark' | 'fabric' | 'metal';

interface FamilyTextures {
  normal: THREE.Texture | null;
  ao: THREE.Texture | null;
  rough: THREE.Texture | null;
  /** parallax height field; stays null when import-time policy requests zero taps */
  disp: THREE.Texture | null;
  /** per-texel metalness (the metal family only): rust patches stay
   *  dielectric while bare metal actually reflects the IBL */
  metal: THREE.Texture | null;
}

interface FamilyDef {
  /** texture basename under /textures/structures/ (or `dir` when set) */
  prefix: string;
  /** texture directory override (rock reuses the shipped terrain set) */
  dir?: string;
  /** default shading-normal blend toward the family detail normal */
  strength: number;
  /** projection tiles per world unit */
  tileScale: number;
  /** AO remap floor (diffuse multiplier at ao=0) */
  aoLo: number;
  /** AO remap span (floor + span is the multiplier at ao=1) */
  aoSpan: number;
  /** how far roughness lerps toward the family roughness map */
  roughMix: number;
  /** floor for envMapIntensity, so the family catches the sky/interior IBL
   *  (metal only today; raised, never lowered, at apply time) */
  envMapMin?: number;
  /** how far metalnessFactor lerps toward the family Metalness map (metal
   *  only; the map is fetched exactly when this is set) */
  metalMix?: number;
  /** MEASURED mean of the family Displacement map: the height signal centers
   *  on this so a biased map (Rock026 mean 0.76) cannot push a constant
   *  parallax drift or a constant brightness lift */
  dispCenter: number;
  /** MEASURED standard deviation of the family Displacement map. The maps
   *  span a 10x spread (Bricks 0.219 to Plaster 0.054), so one global
   *  amplitude can never work: the walk amplitude derives as
   *  parallaxDepth / dispSd, normalizing every family to its target depth. */
  dispSd: number;
  /** TARGET typical parallax depth in projection space (one sd of height
   *  moves the projection this far; world depth = this / tileScale). Deep for
   *  stone/rock/bark, shallow for plaster/fabric. The offset clamp derives as
   *  2.2x this value, so tails cannot break the low-poly silhouette. */
  parallaxDepth: number;
  /** diffuse modulation per ONE SD of sampled height (clamped at 1.5 sd):
   *  recesses darken, crests lighten, so height reads even head-on where the
   *  parallax walk is subtle */
  heightShade: number;
  /** MEASURED mean of the family AmbientOcclusion map (ffmpeg signalstats
   *  over the shipped 1K asset; the method reproduces the documented Rock026
   *  displacement mean 0.760 and Metal013 metalness mean 0.787 exactly).
   *  The distance fade converges the sampled AO to this constant, which is
   *  what the mip chain itself converges to at range, so fading the taps out
   *  cannot shift a distant facade's brightness. Unused when aoSpan is 0. */
  aoMean: number;
  /** MEASURED mean of the family Roughness map (same method); the far
   *  constant the roughness mix converges to. */
  roughMean: number;
  /** MEASURED mean of the family Metalness map (metal only). */
  metalMean?: number;
  tex: FamilyTextures;
}

const emptyTex = (): FamilyTextures => ({
  normal: null,
  ao: null,
  rough: null,
  disp: null,
  metal: null,
});

// Per-family defaults. Stone keeps the original worn-stone numbers exactly
// (one ashlar course reads ~2.6 units); wood and plaster are progressively
// gentler so painted timber and washed walls stay toy-like.
const FAMILIES: Record<SurfaceFamily, FamilyDef> = {
  stone: {
    prefix: 'Bricks076A',
    strength: 0.45,
    tileScale: 1 / 2.6,
    aoLo: 0.72,
    aoSpan: 0.32,
    roughMix: 0.5,
    dispCenter: 0.456,
    dispSd: 0.219,
    parallaxDepth: 0.06,
    heightShade: 0.15,
    aoMean: 0.756,
    roughMean: 0.731,
    tex: emptyTex(),
  },
  // NATURAL geological stone: chaotic fracture, no mortar lines. Boulders,
  // scree, cliffs, cave mouths, and meteor rock route here so they never grow
  // the ashlar running-bond pattern that belongs to MASONRY (the 'stone'
  // family above). Reuses the shipped terrain Rock026 set; tiled coarser than
  // stone because natural fracture reads better at boulder scale.
  rock: {
    prefix: 'Rock026',
    dir: '/textures/terrain/',
    strength: 0.5,
    tileScale: 1 / 3.4,
    aoLo: 0.72,
    aoSpan: 0.3,
    roughMix: 0.5,
    dispCenter: 0.76,
    dispSd: 0.077,
    parallaxDepth: 0.06,
    heightShade: 0.19,
    aoMean: 0.982,
    roughMean: 0.51,
    tex: emptyTex(),
  },
  wood: {
    prefix: 'MedievalWood',
    strength: 0.4,
    tileScale: 1 / 1.8,
    aoLo: 0.78,
    aoSpan: 0.26,
    roughMix: 0.4,
    dispCenter: 0.468,
    dispSd: 0.118,
    parallaxDepth: 0.045,
    heightShade: 0.11,
    aoMean: 0.729,
    roughMean: 0.535,
    tex: emptyTex(),
  },
  plaster: {
    prefix: 'Plaster007',
    strength: 0.35,
    tileScale: 1 / 2.2,
    aoLo: 0.82,
    aoSpan: 0.2,
    roughMix: 0.35,
    // capped low: the plaster height map has little signal to give (sd
    // 0.054), and amplifying it further just amplifies compression noise
    dispCenter: 0.459,
    dispSd: 0.054,
    parallaxDepth: 0.02,
    heightShade: 0.07,
    aoMean: 0.931,
    roughMean: 0.499,
    tex: emptyTex(),
  },
  // Vertical oak ridges; the triplanar side planes map texture Y to world Y,
  // so the grain runs along the trunk. Deep displacement (std 0.125) makes
  // trunks the best parallax reader in the set.
  bark: {
    prefix: 'Bark012',
    strength: 0.55,
    tileScale: 1 / 1.6,
    aoLo: 0.7,
    aoSpan: 0.34,
    roughMix: 0.45,
    dispCenter: 0.5,
    dispSd: 0.125,
    parallaxDepth: 0.07,
    heightShade: 0.21,
    aoMean: 0.855,
    roughMean: 0.674,
    tex: emptyTex(),
  },
  // Plain isotropic weave (row/col variance ratio 0.77 to 1.15 at 1K): reads
  // as thread-level roughness variation, never corduroy. Kept the gentlest of
  // the set so banners/tents stay painted-cloth, not upholstery.
  fabric: {
    prefix: 'Fabric030',
    strength: 0.3,
    tileScale: 1 / 1.2,
    aoLo: 0.86,
    aoSpan: 0.15,
    roughMix: 0.35,
    dispCenter: 0.432,
    dispSd: 0.11,
    parallaxDepth: 0.015,
    heightShade: 0.04,
    aoMean: 0.925,
    roughMean: 0.728,
    tex: emptyTex(),
  },
  // Patina-worn metal (ambientCG Metal013): rust patches over bare steel WITH
  // a real per-texel Metalness map (mean 0.787, sd 0.232), so rust reads
  // dielectric while bare metal actually reflects the IBL. The old
  // RustCoarse01 set physically could not gleam: rough mean 0.777, disp sd
  // 0.020, no metalness anywhere, and its envMapMin 1.55 was boosting an IBL
  // term the BRDF discarded at metalness 0. With real metalness the floor
  // drops to a cozy 1.2. No AmbientOcclusion map ships with the set (aoSpan
  // 0 skips both the fetch and the grime term); the roughness + metalness
  // mixes carry the patch variation instead.
  metal: {
    prefix: 'Metal013',
    strength: 0.35,
    tileScale: 1 / 1.4,
    aoLo: 1,
    aoSpan: 0,
    roughMix: 0.75,
    envMapMin: 1.2,
    metalMix: 0.9,
    dispCenter: 0.271,
    dispSd: 0.122,
    parallaxDepth: 0.045,
    heightShade: 0.08,
    aoMean: 1,
    roughMean: 0.438,
    metalMean: 0.787,
    tex: emptyTex(),
  },
};

/** View-ray refinement taps and offset-clamp share come from the derived
 *  gfx.ts knobs (GFX.surfaceDetailTaps / GFX.surfaceDetailClampK, one source
 *  for the tier ladder AND the Advanced Surface Detail dial): insane takes 4
 *  taps at the full clamp (the pre-round-10 ultra execution, kept exactly),
 *  ultra 3 at 0.85, and high 0. The normalized amplitudes walk real depth,
 *  and the deeper clamps need the extra refinement to stay swim-free,
 *  which is why the 3-tap execution shrinks its clamp (the round-10
 *  screenshot A/B on the keep wall / boulder / town street reads the 3-tap
 *  0.85-clamp walk as the same relief while dropping the fourth dependent
 *  fetch). Ultra shipped at 6 taps originally; round 9 measured 4 at full
 *  clamp indistinguishable from 6, round 10 moved that execution to the
 *  opt-in insane tier. */
const parallaxTierTaps = (): number => GFX.surfaceDetailTaps;
const parallaxTierClampK = (): number => GFX.surfaceDetailClampK;
/** Offset clamp as a multiple of the family's target depth (2.2 sd of height
 *  is where the tails start breaking the low-poly silhouette). */
const PARALLAX_CLAMP_K = 2.2;
/** Height-shade clamp in sd units: recess darkening saturates at 1.5 sd. */
const HEIGHT_SHADE_CLAMP_SD = 1.5;

// ---------------------------------------------------------------------------
// Distance fades (perf): the layer costs up to 21 texture taps per fragment on
// insane, and a town street pays that full price for every DISTANT facade whose
// detail the mips have already averaged away. Two per-family fades, derived
// from the shipped amplitudes against the reference viewport (900px tall,
// CAMERA_BASE_FOV 60: 779.4 screen px per world unit at 1 unit):
//   - PARALLAX fades out where a one-sd walk offset (parallaxDepth/tileScale
//     world units, scaled by the ~0.7 mean obliquity of a readable surface)
//     projects under PARALLAX_FADE_PX screen pixels: the warp is sub-feature
//     there, and past the end the whole tap loop is branch-skipped.
//   - The DETAIL layer (normal/AO/rough/metal taps) fades where the sampled
//     mip has averaged the maps toward their measured means (mip
//     DETAIL_FADE_MIP of the 1K set for one tile of 1/tileScale world units).
//     Each term converges to its MEASURED-MEAN constant, exactly what the mip
//     chain itself shows at that distance, so a distant facade's brightness,
//     roughness, and metalness cannot shift; past the end every tap is
//     branch-skipped.
// Fade bands verified by screenshot A/B (?wornfade=off) in
// scripts/round9_fade_shots.mjs: the diff at the band must sit at the noise
// floor. The ?wornfade=x<mult> dev override scales every band for that
// verification; it is not a player surface.
// ---------------------------------------------------------------------------
/** Reference viewport: 900px tall at CAMERA_BASE_FOV 60 (renderer.ts). */
const REF_PX_PER_UNIT = 900 / (2 * Math.tan((60 / 2) * (Math.PI / 180)));
/** Screen-pixel size of a one-sd parallax offset at the fade end. */
const PARALLAX_FADE_PX = 2;
/** Mean obliquity factor: the walk offset lies along the view ray, so only
 *  its in-surface component (sin of the incidence angle, ~0.7 for a readable
 *  facade) survives the screen projection. */
const PARALLAX_OBLIQUITY = 0.7;
/** Parallax fade-end floor: even the shallow families (fabric 0.018 world
 *  units of depth) keep their full walk through melee/interaction range. */
const PARALLAX_FADE_MIN_END = 16;
/** Detail fade end: the mip of the 1K maps whose averaging has flattened the
 *  layer's content (32x32 per tile). */
const DETAIL_FADE_MIP = 5;
const DETAIL_TEXTURE_SIZE = 1024;
/** Fade-band starts as a fraction of their ends (a wide band so the blend is
 *  never a visible frontier). */
const PARALLAX_FADE_START_K = 0.55;
const DETAIL_FADE_START_K = 0.6;

export interface SurfaceDetailFadeBands {
  parStart: number;
  parEnd: number;
  detStart: number;
  detEnd: number;
}

/**
 * Pure fade-band derivation from a family's parallax depth (projection space)
 * and the EFFECTIVE tile scale (opts overrides included, so the coarse-tiled
 * great-tree bark keeps its detail proportionally farther out). Exported for
 * tests; deterministic.
 */
export function surfaceDetailFadeBands(
  parallaxDepth: number,
  tileScale: number,
): SurfaceDetailFadeBands {
  const worldDepth = parallaxDepth / tileScale;
  const detEnd = (2 ** DETAIL_FADE_MIP * REF_PX_PER_UNIT) / (DETAIL_TEXTURE_SIZE * tileScale);
  const parEnd = Math.min(
    Math.max(
      (PARALLAX_OBLIQUITY * worldDepth * REF_PX_PER_UNIT) / PARALLAX_FADE_PX,
      PARALLAX_FADE_MIN_END,
    ),
    detEnd,
  );
  return {
    parStart: parEnd * PARALLAX_FADE_START_K,
    parEnd,
    detStart: detEnd * DETAIL_FADE_START_K,
    detEnd,
  };
}

/** Dominant-plane collapse cutoff: triplanar weights below it fade to zero
 *  and the rest renormalize, so any surface within ~33 degrees of a
 *  projection axis becomes EXACTLY one-hot and the single-tap fast paths in
 *  the shader activate with no threshold discontinuity (the weight reaches
 *  1.0 continuously before the branch can trigger). */
const DOMINANT_PLANE_CUTOFF = 0.15;

/** Dev-only A/B override for the fade verification harness: ?wornfade=off
 *  pushes every band out of range (the pre-fade image), ?wornfade=x<mult>
 *  scales the bands. Headless hosts have no location and keep the default. */
const FADE_SCALE = ((): number => {
  if (typeof location === 'undefined') return 1;
  const v = new URLSearchParams(location.search).get('wornfade');
  if (!v) return 1;
  if (v === 'off') return 1e5;
  const m = /^x([\d.]+)$/.exec(v);
  const k = m ? Number(m[1]) : 1;
  return Number.isFinite(k) && k > 0 ? k : 1;
})();

const scaledFadeBands = (parallaxDepth: number, tileScale: number): SurfaceDetailFadeBands => {
  const b = surfaceDetailFadeBands(parallaxDepth, tileScale);
  return {
    parStart: b.parStart * FADE_SCALE,
    parEnd: b.parEnd * FADE_SCALE,
    detStart: b.detStart * FADE_SCALE,
    detEnd: b.detEnd * FADE_SCALE,
  };
};

// Tiers below high never compile the layer (GFX.surfaceDetail: the round-10
// medium regate measured the residual detail taps as the whole medium-town
// gap, so medium keeps its pre-overhaul surfaces), so skip the fetches there
// (the detail_normals.ts pattern). Loader cache results are immutable: we own
// CLONES (shared decoded image, one extra GPU texture each), so the
// anisotropy tweak cannot leak into another consumer of the same URL. All
// maps are non-color data and stay in linear space. Every fetch keys off the
// IMPORT-TIME tier guess: if the live tier lands lower the textures merely
// idle. A high import-time policy loads the base layer without displacement;
// if the live policy later requests ultra parallax, it fails soft to that base
// material (the detail_normals null contract, the canopy_detail precedent).
if (GFX.surfaceDetail) {
  const wantDisp = parallaxTierTaps() > 0;
  for (const fam of Object.values(FAMILIES)) {
    const prep = (name: string): Promise<THREE.Texture> =>
      loadTexture(`${fam.dir ?? '/textures/structures/'}${fam.prefix}_${name}.jpg`, {
        repeat: true,
      }).then((tex) => {
        const t = tex.clone();
        t.anisotropy = 4;
        t.needsUpdate = true;
        return t;
      });
    registerDeferredPreload(() =>
      Promise.all([
        prep('NormalGL'),
        // aoSpan 0 also means the set ships no AmbientOcclusion (Metal013)
        fam.aoSpan > 0 ? prep('AmbientOcclusion') : Promise.resolve(null),
        prep('Roughness'),
        wantDisp ? prep('Displacement') : Promise.resolve(null),
        fam.metalMix !== undefined ? prep('Metalness') : Promise.resolve(null),
      ]).then(([n, a, r, d, m]) => {
        fam.tex.normal = n;
        fam.tex.ao = a;
        fam.tex.rough = r;
        fam.tex.disp = d;
        fam.tex.metal = m;
      }),
    );
  }
}

// Material.clone() copies userData (a false "already applied" marker on
// clones, which deliberately DROP the onBeforeCompile hook), so the real
// once-per-instance guard is identity-based; userData.surfaceDetail stays as
// an inspectable marker only.
const applied = new WeakSet<THREE.Material>();

export interface SurfaceDetailOpts {
  /** Shading-normal blend toward the family detail normal (family default). */
  strength?: number;
  /** Projection tiles per unit (family default). */
  tileScale?: number;
  /**
   * Project in OBJECT space instead of world space: for props that MOVE
   * (held weapons), a world projection swims across the mesh as it animates.
   * Object mode pins the pattern to the mesh and composes AO + roughness
   * only: reorienting a tangent-space detail normal sampled on object planes
   * against the world lighting frame needs the model rotation in the
   * fragment shader (not available), and scalar terms need no orientation.
   * strength then scales the AO/roughness depth instead. Parallax is skipped
   * (the view ray is only known in world space).
   */
  objectSpace?: boolean;
  /**
   * 4x4 atlas-cell strength mask (16 entries, row-major from the top-left
   * cell, the EASTBROOK_SURFACE_CELLS numbering): scales the whole layer per
   * fragment by the cell the material's own `map` UV lands in, so one merged
   * vertex-colored batch can carry full detail on stone cells and taper it on
   * canvas/crystal cells. Requires a bound `map` whose UVs were synthesized
   * into the 4x4 cell layout; ignored otherwise. Compile-time constant.
   */
  cellMask?: readonly number[];
}

/** Back-compat option alias (the layer began stone-only). */
export type WornStoneOpts = SurfaceDetailOpts;

// ---------------------------------------------------------------------------
// Family routing for the shared GLB-kit material converters (props.ts and
// quest_objects.ts import this so the table lives in exactly one place).
// Matching runs on the SOURCE material name: the converters already key their
// caches by kit + source name, so application is deterministic per material.
// ---------------------------------------------------------------------------

/** Kit-wide stone members (hex curtain walls, the Evergarden gate arch sample
 *  palette gradient strips are dressed MASONRY; minerock boulders are
 *  geological and take the natural rock family instead). */
const STONE_KITS: Record<string, WornFamilyPick> = {
  khex: { family: 'stone', strength: 0.45 },
  kiron: { family: 'stone', strength: 0.45 },
  minerock: { family: 'rock', strength: 0.55 },
};

/** Names that must NEVER take the layer: canopies and ground cover stay clean
 *  color cards, organic skin/face/hair belongs to the character art, and
 *  glass/window/glow/fx surfaces are transparent or self-lit. */
const SKIP_NAME =
  /leaf|leaves|foliage|bush|grass|flower|plant|vine|moss|skin|face|body|hair|eye|glass|window|glow|flame|fire|lava|water|crystal|gem/i;
const BARK_NAME = /bark|trunk/i;
const FABRIC_NAME = /cloth|fabric|banner|flag|tent|sail|awning|carpet|rug|bag|leather|strap|rope/i;
const METAL_NAME_ROUTE = /metal|iron|steel|gold|silver|anvil|chain|blade|bell/i;
const WOOD_NAME = /wood|plank|log|stump|timber|crate|barrel|fence|furniture|walnut/i;
/** Clay/slate roof tiles (RoofTiles, RoofTiles_Red across the palette kits):
 *  course-lined like masonry but softer, so low-strength stone. */
const ROOF_NAME = /roof|shingle|tile/i;
/** NATURAL geological surfaces: never the ashlar masonry pattern. Checked
 *  before STONE_NAME so 'boulder'/'cliff' names cannot land on brick. */
const ROCK_NAME = /rock|boulder|canyon|cliff|crag|scree|cave/i;
/** Player-built / dressed architectural stone (masonry courses). */
const STONE_NAME = /stone|brick|pillar|column|grave|ruin|marble|statue|mine/i;
const PLASTER_NAME = /plaster|wall/i;

export interface WornFamilyPick {
  family: SurfaceFamily;
  strength: number;
}

/** Per-kit fallback for materials whose NAME says nothing (measured against
 *  the shipped kits: single-atlas palettes such as colormap/texture). null is
 *  an explicit skip (Tripo painterly bakes, mushroom caps). Kits absent here
 *  fall through to the low-strength bare-coverage stone default. */
const KIT_FALLBACK: Record<string, WornFamilyPick | null> = {
  hollow: null, // Tripo painterly bakes with a soft emissive re-emit
  shroom: null, // mushroom caps read as clean color cards
  tent: { family: 'fabric', strength: 0.3 }, // colorRed/colorRedDark canvas
  pirate: { family: 'wood', strength: 0.35 }, // colormap docks/rowboats
  town: { family: 'wood', strength: 0.35 }, // colormap timber pillar
  grave: { family: 'stone', strength: 0.45 }, // colormap gravestones
  dungeon: { family: 'rock', strength: 0.45 }, // 'texture' atlas delve cave mouths
  kcas: { family: 'stone', strength: 0.4 }, // 'texture' atlas castle pieces
  tools: { family: 'wood', strength: 0.3 }, // 'tools' atlas crafting stations
};

/** Bare-coverage default: nothing in the kit pipeline ships without a family,
 *  but unmatched palette cells stay at a whisper of stone. This is the
 *  EXPLICIT landing spot for the say-nothing names measured across the kits
 *  (_defaultMat, Main, Top, Bottom, Beige, Black, Material.00N, ...): they
 *  route here deliberately, after the kit fallbacks have had their say. */
const FALLBACK_STONE_STRENGTH = 0.22;

/**
 * Name-only family heuristic shared by every converter. Returns a pick, null
 * for an explicit skip (leaves, skin, glass, glow), or undefined when the
 * name says nothing (the caller then applies its kit/module fallback).
 */
export function wornFamilyForName(materialName: string): WornFamilyPick | null | undefined {
  if (SKIP_NAME.test(materialName)) return null;
  if (BARK_NAME.test(materialName)) return { family: 'bark', strength: 0.5 };
  if (FABRIC_NAME.test(materialName)) return { family: 'fabric', strength: 0.3 };
  if (METAL_NAME_ROUTE.test(materialName)) return { family: 'metal', strength: 0.35 };
  if (WOOD_NAME.test(materialName)) return { family: 'wood', strength: 0.35 };
  if (ROOF_NAME.test(materialName)) return { family: 'stone', strength: 0.3 };
  if (ROCK_NAME.test(materialName)) return { family: 'rock', strength: 0.5 };
  if (STONE_NAME.test(materialName)) return { family: 'stone', strength: 0.4 };
  if (PLASTER_NAME.test(materialName)) return { family: 'plaster', strength: 0.35 };
  return undefined;
}

export interface WornFamilyContext {
  /** glowing surfaces stay clean (painted windows, lantern glass) */
  emissive?: boolean;
  /** transparent surfaces stay clean */
  transparent?: boolean;
  /** the material ships its own normal/roughness maps (Tripo PBR props): the
   *  bare-coverage fallback is skipped, explicit name routes still apply */
  hasOwnMaps?: boolean;
}

/**
 * Resolve which surface-detail family a kit material takes, from the kit id
 * and the SOURCE material name. Kit-wide stone entries win; names route next;
 * per-kit fallbacks cover single-atlas palettes; everything else that is
 * opaque, non-emissive, and not already PBR-mapped lands on low-strength
 * stone so no kit material ships bare. Deterministic and log-free.
 */
export function wornFamilyFor(
  kit: string,
  materialName: string,
  ctx?: WornFamilyContext,
): WornFamilyPick | null {
  if (ctx?.emissive || ctx?.transparent) return null;
  const kitWide = STONE_KITS[kit];
  if (kitWide !== undefined) return kitWide;
  const named = wornFamilyForName(materialName);
  if (named !== undefined) return named;
  const kitFallback = KIT_FALLBACK[kit];
  if (kitFallback !== undefined) return kitFallback;
  if (ctx?.hasOwnMaps) return null;
  return { family: 'stone', strength: FALLBACK_STONE_STRENGTH };
}

/**
 * Routing for the foliage kit's own converter: trunks take bark, the shared
 * boulder fields take a stronger stone; leaves/flowers/mushrooms return null
 * (canopies must stay clean).
 */
export function foliageWornFamilyFor(materialName: string): WornFamilyPick | null {
  if (BARK_NAME.test(materialName)) return { family: 'bark', strength: 0.55 };
  if (/rock/i.test(materialName)) return { family: 'rock', strength: 0.5 };
  return null;
}

/**
 * Coarse, strong bark for the GIANT landmark trees (the greatTrees clones in
 * realm_flora / garden / haunt / jungle features): the default 1/1.6 bark
 * tiling reads as noise on a trunk yards wide, so giants take ridges nearly
 * 3x larger and a stronger normal so the grain survives at vista distance.
 */
export const GREAT_TREE_BARK_DETAIL: SurfaceDetailOpts = Object.freeze({
  strength: 0.65,
  tileScale: 1 / 4.5,
});

/** Shared trunk matcher for the great-tree decorators (Bark_TwistedTree). */
export function isBarkMaterialName(name: string): boolean {
  return BARK_NAME.test(name);
}

/**
 * Routing for rigged character/creature materials: explicit cloth-named and
 * armor-metal-named materials only, at LOW strength (the caller applies the
 * layer in OBJECT space: rigs animate, a world projection swims). Class-body
 * atlases (knight, mage, ...), creature fur, and skin/face/hair never match,
 * and there is deliberately NO fallback here.
 */
export function riggedWornFamilyFor(materialName: string): WornFamilyPick | null {
  if (SKIP_NAME.test(materialName)) return null;
  if (FABRIC_NAME.test(materialName)) return { family: 'fabric', strength: 0.2 };
  if (METAL_NAME_ROUTE.test(materialName)) return { family: 'metal', strength: 0.2 };
  return null;
}

/**
 * Attach the triplanar surface-detail layer for a material family to a
 * standard material. Composes with any existing onBeforeCompile hook (runs it
 * first) and is additive over the material's own map/vertexColors path, so
 * palette-atlas colorways survive. Safe to call more than once on the same
 * instance (the first application wins); no-op on the Lambert tier.
 */
export function applySurfaceDetail(
  mat: THREE.MeshStandardMaterial,
  family: SurfaceFamily,
  opts?: SurfaceDetailOpts,
): void {
  // HIGH AND UP (GFX.surfaceDetail; the Advanced Surface Detail dial maps
  // onto the same knob): high keeps the basic normal/AO/rough layer with no
  // parallax walk, while ultra and insane add the view-ray refinement. Medium
  // keeps its pre-overhaul surfaces and frame budget.
  if (!GFX.surfaceDetail || !mat.isMeshStandardMaterial) return;
  // Dev-only perf-attribution kill switch (?worndetail=off): the whole layer
  // stays un-applied, so an A/B bench run isolates its cost.
  if (renderLayerDisabled('worndetail')) return;
  if (applied.has(mat)) return;
  applied.add(mat);
  mat.userData.surfaceDetail = family;
  if (family === 'stone') mat.userData.wornStone = true; // legacy marker
  // JSON-safe reapplication record: Material.clone() deep-copies userData but
  // DROPS onBeforeCompile, so clone sites (the camera-ghost material clones in
  // props.ts registerHideable) re-attach the layer from this spec.
  mat.userData.surfaceDetailSpec = {
    family,
    strength: opts?.strength,
    tileScale: opts?.tileScale,
    objectSpace: opts?.objectSpace,
    cellMask: opts?.cellMask ? [...opts.cellMask] : undefined,
  };
  const fam = FAMILIES[family];
  // Reflectivity floor (metal): raise, never lower, so the props/weapon env
  // boosts that already sit higher keep their tuned values.
  if (fam.envMapMin !== undefined && mat.envMapIntensity < fam.envMapMin)
    mat.envMapIntensity = fam.envMapMin;
  const strength = opts?.strength ?? fam.strength;
  const tileScale = opts?.tileScale ?? fam.tileScale;
  const objectSpace = opts?.objectSpace === true;
  // The cell mask reads the material's own map UV (vMapUv only exists with a
  // bound map) and is baked as a compile-time constant array.
  const cellMask = opts?.cellMask && opts.cellMask.length === 16 && mat.map ? opts.cellMask : null;
  // In object mode strength cannot act on the (skipped) normal blend, so it
  // scales the scalar terms relative to the family default instead.
  const scalarK = objectSpace ? Math.min(strength / fam.strength, 1) : 1;
  const aoLo = 1 - (1 - fam.aoLo) * scalarK;
  const aoSpan = fam.aoSpan * scalarK;
  const roughMix = fam.roughMix * scalarK;
  const metalMix = (fam.metalMix ?? 0) * scalarK;
  const prev = mat.onBeforeCompile;
  const prevSrc = typeof prev === 'function' ? prev.toString() : '';
  mat.onBeforeCompile = (shader, renderer) => {
    prev?.call(mat, shader, renderer);
    // Fail soft before the preload gate resolves: the material simply ships
    // without the layer (the detail_normals null contract). AO is required
    // only for families that actually run the grime term (Metal013 ships no
    // AmbientOcclusion and sets aoSpan 0).
    if (!fam.tex.normal || !fam.tex.rough) return;
    const hasAo = fam.aoSpan > 0 && fam.tex.ao !== null;
    if (fam.aoSpan > 0 && !hasAo) return;
    const hasMetal = metalMix > 0 && fam.tex.metal !== null;
    // Parallax gates on the LIVE policy at compile time (0 taps on high, 3 on
    // ultra, 4 on insane) plus a resolved height field, and needs the
    // world-space view ray.
    const taps = !objectSpace && fam.tex.disp !== null ? parallaxTierTaps() : 0;
    const parallax = taps > 0;
    // Normalized amplitude: one sd of height walks the projection by the
    // family's target depth, whatever the map's dynamic range (the shipped
    // sds span 10x, so a global amplitude can never read evenly).
    const parallaxAmp = fam.parallaxDepth / fam.dispSd;
    // The 3-tap tiers take a shallower clamp: depth they cannot refine would
    // otherwise swim at grazing angles (insane's 4 taps keep the full clamp).
    const parallaxClamp = PARALLAX_CLAMP_K * fam.parallaxDepth * parallaxTierClampK();
    // Distance-fade bands from the EFFECTIVE tile scale (opts override
    // included). Object-space projections have no world position to measure
    // a camera distance from, and their consumers (held weapons) live at
    // arm's length anyway, so they keep the full layer unconditionally.
    const fade = scaledFadeBands(fam.parallaxDepth, tileScale);
    shader.uniforms.uWornNormal = { value: fam.tex.normal };
    if (hasAo) shader.uniforms.uWornAo = { value: fam.tex.ao };
    shader.uniforms.uWornRough = { value: fam.tex.rough };
    shader.uniforms.uWornStrength = { value: strength };
    shader.uniforms.uWornTile = { value: tileScale };
    if (hasAo) shader.uniforms.uWornAoLo = { value: aoLo };
    if (hasAo) shader.uniforms.uWornAoSpan = { value: aoSpan };
    shader.uniforms.uWornRoughMix = { value: roughMix };
    if (hasMetal) shader.uniforms.uWornMetal = { value: fam.tex.metal };
    if (hasMetal) shader.uniforms.uWornMetalMix = { value: metalMix };
    if (parallax) shader.uniforms.uWornDisp = { value: fam.tex.disp };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vWornWorldPos;
        varying vec3 vWornWorldNormal;`,
      )
      .replace(
        '#include <project_vertex>',
        objectSpace
          ? // Object space: the raw pre-instance, pre-model position pins the
            // pattern to the mesh however its node animates.
            `#include <project_vertex>
        vWornWorldPos = transformed;
        vWornWorldNormal = normalize( objectNormal );`
          : `#include <project_vertex>
        vec4 wornPos = vec4( transformed, 1.0 );
        vec3 wornNrm = objectNormal;
        #ifdef USE_INSTANCING
          wornPos = instanceMatrix * wornPos;
          wornNrm = mat3( instanceMatrix ) * wornNrm;
        #endif
        vWornWorldPos = ( modelMatrix * wornPos ).xyz;
        vWornWorldNormal = normalize( mat3( modelMatrix ) * wornNrm );`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vWornWorldPos;
        varying vec3 vWornWorldNormal;
        uniform sampler2D uWornNormal;
        uniform sampler2D uWornRough;
        uniform float uWornStrength;
        uniform float uWornTile;
        uniform float uWornRoughMix;
        ${hasAo ? 'uniform sampler2D uWornAo; uniform float uWornAoLo; uniform float uWornAoSpan;' : ''}
        ${hasMetal ? 'uniform sampler2D uWornMetal; uniform float uWornMetalMix;' : ''}
        ${parallax ? 'uniform sampler2D uWornDisp;' : ''}
        float wornTriR(
          sampler2D tex,
          const in vec3 p,
          const in vec3 w,
          const in vec3 axis
        ) {
          // Dominant-plane fast path: the weight collapse below makes any
          // surface within ~33deg of a projection axis exactly one-hot, so a
          // flat wall pays one tap instead of three. The branch is coherent
          // per surface (weights are constant across a facet).
          if ( w.x >= 0.999 ) return texture2D( tex, p.zy ).r;
          if ( w.y >= 0.999 ) return texture2D( tex, p.xz ).r;
          if ( w.z >= 0.999 ) return texture2D( tex, p.xy ).r;
          // Exact geometric-axis zeroes are coherent across the flat facets
          // used by town kits. Preserve the two active terms in their
          // original order and omit only the fetch multiplied by exact zero.
          if ( axis.x <= 0.0 )
            return texture2D( tex, p.xz ).r * w.y + texture2D( tex, p.xy ).r * w.z;
          if ( axis.y <= 0.0 )
            return texture2D( tex, p.zy ).r * w.x + texture2D( tex, p.xy ).r * w.z;
          if ( axis.z <= 0.0 )
            return texture2D( tex, p.zy ).r * w.x + texture2D( tex, p.xz ).r * w.y;
          return texture2D( tex, p.zy ).r * w.x + texture2D( tex, p.xz ).r * w.y
            + texture2D( tex, p.xy ).r * w.z;
        }`,
      )
      .replace(
        // color_fragment runs before the roughness and normal chunks, so the
        // shared projection locals declared here are in scope for both.
        '#include <color_fragment>',
        `#include <color_fragment>
        vec3 wornP = vWornWorldPos * uWornTile;
        vec3 wornUnitN = normalize( vWornWorldNormal );
        vec3 wornAxis = abs( wornUnitN );
        vec3 wornW = pow( wornAxis, vec3( 4.0 ) );
        wornW /= ( wornW.x + wornW.y + wornW.z );
        // Dominant-plane collapse: minor weights below the cutoff fade to
        // zero and the rest renormalize, so near-axis surfaces reach an EXACT
        // one-hot weight continuously and the single-tap fast paths in
        // wornTriR (and the normal blend below) activate with no threshold
        // discontinuity. The sum can never hit zero: the largest pow-4 weight
        // is always at least one third.
        wornW = max( wornW - ${DOMINANT_PLANE_CUTOFF.toFixed(2)}, 0.0 );
        wornW /= ( wornW.x + wornW.y + wornW.z );
        float wornCellK = 1.0;
        ${
          cellMask
            ? `{
          const float wornCellMask[16] = float[16]( ${cellMask
            .map((k) => k.toFixed(3))
            .join(', ')} );
          int wornCol = clamp( int( floor( vMapUv.x * 4.0 ) ), 0, 3 );
          int wornRow = clamp( int( floor( ( 1.0 - vMapUv.y ) * 4.0 ) ), 0, 3 );
          wornCellK = wornCellMask[ wornRow * 4 + wornCol ];
        }`
            : ''
        }
        ${
          objectSpace
            ? 'float wornDetK = 1.0;'
            : `float wornCamD = distance( vWornWorldPos, cameraPosition );
        float wornDetK = 1.0 - smoothstep( ${fade.detStart.toFixed(1)}, ${fade.detEnd.toFixed(1)}, wornCamD );`
        }
        ${
          parallax
            ? `float wornHShade = 0.0;
        if ( wornCamD < ${fade.parEnd.toFixed(1)} ) {
          // Multi-tap parallax (3 on ultra, 4 on insane): estimate height, then
          // refine along the view ray, walking the projection by the averaged
          // offset. The amplitude is sd-normalized (one sd of height = the
          // family's target depth) and the offset clamps at 2.2 sd so tails
          // never break the low-poly silhouette. The whole loop is
          // branch-skipped past the fade end, where a one-sd offset projects
          // under ${PARALLAX_FADE_PX} screen pixels; the fade band eases the
          // offset (and its height shade) to zero so no frontier is visible.
          float wornParK = 1.0 - smoothstep( ${fade.parStart.toFixed(1)}, ${fade.parEnd.toFixed(1)}, wornCamD );
          vec3 wornV = normalize( vWornWorldPos - cameraPosition );
          float wornH = wornTriR( uWornDisp, wornP, wornW, wornAxis ) - ${fam.dispCenter.toFixed(3)};
          float wornHAcc = wornH;
          ${Array.from(
            { length: taps - 1 },
            () => `wornH = wornTriR( uWornDisp,
            wornP + wornV * ( wornH * ${parallaxAmp.toFixed(3)} ), wornW, wornAxis ) - ${fam.dispCenter.toFixed(3)};
          wornHAcc += wornH;`,
          ).join('\n          ')}
          wornP += clamp(
            wornV * ( wornHAcc * ${(parallaxAmp / taps).toFixed(4)} ),
            vec3( -${parallaxClamp.toFixed(3)} ), vec3( ${parallaxClamp.toFixed(3)} ) ) * wornParK;
          wornHShade = clamp( wornH * ${(1 / fam.dispSd).toFixed(3)},
            -${HEIGHT_SHADE_CLAMP_SD.toFixed(1)}, ${HEIGHT_SHADE_CLAMP_SD.toFixed(1)} ) * wornParK;
        }`
            : ''
        }
        ${
          parallax
            ? `diffuseColor.rgb *= 1.0 + wornHShade * ${fam.heightShade.toFixed(2)} * wornCellK;`
            : ''
        }
        ${
          hasAo
            ? `float wornAoV = ${fam.aoMean.toFixed(3)};
        if ( wornDetK > 0.0 ) wornAoV = mix( ${fam.aoMean.toFixed(3)}, wornTriR( uWornAo, wornP, wornW, wornAxis ), wornDetK );
        diffuseColor.rgb *= mix( 1.0, uWornAoLo + wornAoV * uWornAoSpan, wornCellK );`
            : ''
        }`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        // Past the detail fade the sampled roughness converges to the map's
        // measured mean: the same constant its mips converge to, so distant
        // sheen cannot shift; the taps are branch-skipped there.
        `#include <roughnessmap_fragment>
        float wornRoughV = ${fam.roughMean.toFixed(3)};
        if ( wornDetK > 0.0 ) wornRoughV = mix( ${fam.roughMean.toFixed(3)}, wornTriR( uWornRough, wornP, wornW, wornAxis ), wornDetK );
        roughnessFactor = mix( roughnessFactor, wornRoughV, uWornRoughMix * wornCellK );`,
      );
    if (hasMetal) {
      // metalnessmap_fragment unconditionally declares `float metalnessFactor
      // = metalness;`, so the per-texel patina composes cleanly after it: rust
      // patches stay dielectric, bare metal reflects the IBL per fragment.
      // Past the detail fade the per-texel patina converges to the measured
      // Metalness mean (0.787), the mip-average a distant surface samples.
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>
        float wornMetalV = ${(fam.metalMean ?? 0).toFixed(3)};
        if ( wornDetK > 0.0 ) wornMetalV = mix( ${(fam.metalMean ?? 0).toFixed(3)}, wornTriR( uWornMetal, wornP, wornW, wornAxis ), wornDetK );
        metalnessFactor = mix( metalnessFactor, wornMetalV, uWornMetalMix * wornCellK );`,
      );
    }
    if (!objectSpace) {
      shader.fragmentShader = shader.fragmentShader.replace(
        // Whiteout-blend triplanar normal (Golus), mixed into the shading
        // normal AFTER any material normal map so the layer stays additive.
        // The blend eases to identity across the detail fade band (a
        // mip-flattened detail normal converges to the geometric normal
        // anyway) and the taps are branch-skipped past its end; the one-hot
        // weights from the dominant-plane collapse take single-tap paths.
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        if ( wornDetK > 0.0 ) {
          vec3 wornGN = wornUnitN * faceDirection;
          vec3 wornWorldN;
          if ( wornW.x >= 0.999 ) {
            vec3 wornNx = texture2D( uWornNormal, wornP.zy ).xyz * 2.0 - 1.0;
            wornNx = vec3( wornNx.xy + wornGN.zy, abs( wornNx.z ) * wornGN.x );
            wornWorldN = normalize( wornNx.zyx );
          } else if ( wornW.y >= 0.999 ) {
            vec3 wornNy = texture2D( uWornNormal, wornP.xz ).xyz * 2.0 - 1.0;
            wornNy = vec3( wornNy.xy + wornGN.xz, abs( wornNy.z ) * wornGN.y );
            wornWorldN = normalize( wornNy.xzy );
          } else if ( wornW.z >= 0.999 ) {
            vec3 wornNz = texture2D( uWornNormal, wornP.xy ).xyz * 2.0 - 1.0;
            wornNz = vec3( wornNz.xy + wornGN.xy, abs( wornNz.z ) * wornGN.z );
            wornWorldN = normalize( wornNz.xyz );
          } else if ( wornAxis.x <= 0.0 ) {
            vec3 wornNy = texture2D( uWornNormal, wornP.xz ).xyz * 2.0 - 1.0;
            vec3 wornNz = texture2D( uWornNormal, wornP.xy ).xyz * 2.0 - 1.0;
            wornNy = vec3( wornNy.xy + wornGN.xz, abs( wornNy.z ) * wornGN.y );
            wornNz = vec3( wornNz.xy + wornGN.xy, abs( wornNz.z ) * wornGN.z );
            wornWorldN = normalize( wornNy.xzy * wornW.y + wornNz.xyz * wornW.z );
          } else if ( wornAxis.y <= 0.0 ) {
            vec3 wornNx = texture2D( uWornNormal, wornP.zy ).xyz * 2.0 - 1.0;
            vec3 wornNz = texture2D( uWornNormal, wornP.xy ).xyz * 2.0 - 1.0;
            wornNx = vec3( wornNx.xy + wornGN.zy, abs( wornNx.z ) * wornGN.x );
            wornNz = vec3( wornNz.xy + wornGN.xy, abs( wornNz.z ) * wornGN.z );
            wornWorldN = normalize( wornNx.zyx * wornW.x + wornNz.xyz * wornW.z );
          } else if ( wornAxis.z <= 0.0 ) {
            vec3 wornNx = texture2D( uWornNormal, wornP.zy ).xyz * 2.0 - 1.0;
            vec3 wornNy = texture2D( uWornNormal, wornP.xz ).xyz * 2.0 - 1.0;
            wornNx = vec3( wornNx.xy + wornGN.zy, abs( wornNx.z ) * wornGN.x );
            wornNy = vec3( wornNy.xy + wornGN.xz, abs( wornNy.z ) * wornGN.y );
            wornWorldN = normalize( wornNx.zyx * wornW.x + wornNy.xzy * wornW.y );
          } else {
            vec3 wornNx = texture2D( uWornNormal, wornP.zy ).xyz * 2.0 - 1.0;
            vec3 wornNy = texture2D( uWornNormal, wornP.xz ).xyz * 2.0 - 1.0;
            vec3 wornNz = texture2D( uWornNormal, wornP.xy ).xyz * 2.0 - 1.0;
            wornNx = vec3( wornNx.xy + wornGN.zy, abs( wornNx.z ) * wornGN.x );
            wornNy = vec3( wornNy.xy + wornGN.xz, abs( wornNy.z ) * wornGN.y );
            wornNz = vec3( wornNz.xy + wornGN.xy, abs( wornNz.z ) * wornGN.z );
            wornWorldN = normalize(
              wornNx.zyx * wornW.x + wornNy.xzy * wornW.y + wornNz.xyz * wornW.z );
          }
          vec3 wornViewN = normalize( ( viewMatrix * vec4( wornWorldN, 0.0 ) ).xyz );
          normal = normalize( mix( normal, wornViewN, uWornStrength * wornDetK ) );
        }`,
      );
    }
  };
  // The default program cache key stringifies onBeforeCompile, and every worn
  // wrapper stringifies identically even when the chained PREVIOUS hook (which
  // edits different source) differs, so re-include its source text (the
  // foliage_collapse precedent). The family's texture-ready state keys too
  // (before the preload resolves the hook compiles to a plain pass-through),
  // as do the projection mode and the tier's parallax tap count.
  mat.customProgramCacheKey = () => {
    const ready =
      fam.tex.normal && fam.tex.rough && (fam.aoSpan === 0 || fam.tex.ao) ? 'on' : 'off';
    const par =
      !objectSpace && fam.tex.disp !== null
        ? `p${parallaxTierTaps()}c${parallaxTierClampK()}`
        : '-';
    const mask = cellMask ? `m${cellMask.join(',')}` : '-';
    const met = metalMix > 0 && fam.tex.metal !== null ? 'met' : '-';
    // The distance-fade bands are baked as compile-time constants and vary
    // with the effective tile scale (and the dev ?wornfade override).
    const fadeBands = scaledFadeBands(fam.parallaxDepth, tileScale);
    const fadeKey = `f${fadeBands.parStart.toFixed(1)},${fadeBands.parEnd.toFixed(1)},${fadeBands.detStart.toFixed(1)},${fadeBands.detEnd.toFixed(1)}`;
    return `surface-detail|${family}|${ready}|${par}|${mask}|${met}|${objectSpace ? 'o' : 'w'}|${fadeKey}|${prevSrc}`;
  };
}

/**
 * Back-compat entry for the original stone-only layer (castle features, realm
 * flora ruins, the portal arch): the stone family with the original defaults.
 */
export function applyWornStone(mat: THREE.MeshStandardMaterial, opts?: WornStoneOpts): void {
  applySurfaceDetail(mat, 'stone', opts);
}

/**
 * Re-attach the surface-detail layer to a Material.clone() of a detailed
 * material: clone copies userData (including the JSON spec recorded at apply
 * time) but silently DROPS the onBeforeCompile hook, which is how the
 * camera-ghost buildings (props.ts registerHideable clones every mesh
 * material so hiding one structure cannot blank a shared material) shipped
 * bare walls while merged siblings kept their texture. No-op for clones of
 * undetailed materials.
 */
export function reapplySurfaceDetailToClone(clone: THREE.Material): void {
  const std = clone as THREE.MeshStandardMaterial;
  if (!std.isMeshStandardMaterial) return;
  const spec = std.userData?.surfaceDetailSpec as
    | (SurfaceDetailOpts & { family: SurfaceFamily })
    | undefined;
  if (!spec || !FAMILIES[spec.family]) return;
  applySurfaceDetail(std, spec.family, spec);
}

/**
 * Every resolved family detail texture (normal/AO/rough/disp/metal clones),
 * for the renderer's boot-prewarm window. These textures are shader UNIFORMS
 * attached in onBeforeCompile, not material properties, so the scene texture
 * sweep (renderer.ts collectObjectTextures reads map/normalMap/... keys) can
 * never find them: without an explicit prewarm they upload on the first live
 * draw that binds them. The Displacement fields are the heavy case: they only
 * load on the parallax tiers (ultra+), and their first-draw decode+upload was
 * measured as 1fps 1%-low windows mid-travel on the historical meadow bench.
 * Empty before the preload gate resolves (call after assetsReady()).
 */
export function surfaceDetailPrewarmTextures(): THREE.Texture[] {
  const out: THREE.Texture[] = [];
  for (const fam of Object.values(FAMILIES)) {
    for (const tex of [fam.tex.normal, fam.tex.ao, fam.tex.rough, fam.tex.disp, fam.tex.metal]) {
      if (tex) out.push(tex);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// surfaceMat + family, for the procedural feature modules.
// ---------------------------------------------------------------------------

const detailedMats = new Map<string, THREE.Material>();

/**
 * A surfaceMat with the surface-detail family attached. surfaceMat dedupes
 * app-wide, so the detailed variant is a one-time CLONE cached per
 * (base uuid, family, opts), never a mutation of the shared instance (the
 * quest_objects.ts pattern). Lambert tier passes the base through untouched.
 * Do not combine with opts.rim: Material.clone() drops the rim hook.
 */
export function detailedSurfaceMat(
  opts: SurfaceMatOpts,
  family: SurfaceFamily,
  detail?: SurfaceDetailOpts,
): THREE.Material {
  const base = surfaceMat(opts);
  // GFX.surfaceDetail (high+): below it applySurfaceDetail would no-op, so
  // skip the clone and hand back the shared base material untouched.
  if (!GFX.surfaceDetail || !(base as THREE.MeshStandardMaterial).isMeshStandardMaterial)
    return base;
  const key = `${base.uuid}|${family}|${detail?.strength ?? ''}|${detail?.tileScale ?? ''}|${detail?.objectSpace ? 'o' : 'w'}|${detail?.cellMask?.join(',') ?? ''}`;
  let mat = detailedMats.get(key);
  if (!mat) {
    mat = base.clone();
    applySurfaceDetail(mat as THREE.MeshStandardMaterial, family, detail);
    detailedMats.set(key, mat);
  }
  return mat;
}
