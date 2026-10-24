import * as THREE from 'three';
import {
  STRIP_MAX_X,
  STRIP_MIN_X,
  WORLD_MAX_X,
  WORLD_MAX_Z,
  WORLD_MIN_X,
  WORLD_MIN_Z,
  WORLD_SIZE,
  ZONES,
} from '../sim/data';
import type { ZoneDef } from '../sim/types';
import { waterLevel } from '../sim/world';
import { activeFarFieldPolicy } from './foliage_impostor';
import { GFX, type GfxSettings, SUN_DIR } from './gfx';
import { idleSlot, runIdleQueue } from './idle_queue';
import {
  advanceWaterLiveness,
  calmOceanUniforms,
  createOceanDepthMaterial,
  createOceanSurfaceMaterial,
  createWaterLiveness,
  DEFAULT_SEA_STATE,
  OCEAN_DEPTH_RENDER_ORDER,
  OCEAN_LOOP_SECONDS,
  OCEAN_MAX_SHEET_RECTS,
  OCEAN_PALETTE_OVERRIDE,
  type OceanSheetRects,
  OceanSimulation,
  type OceanSkyUniforms,
  type OceanSurfaceUniforms,
  oceanPlanForTier,
  rebakeWaterCharacterField,
  SkyReflectionProbe,
  supportsSkyProbe,
} from './ocean';
import { bindSceneSamples } from './scene_sampling';
import { waterNormalish, waterNormalMaps } from './textures';
import {
  bakeSwellGate,
  buildWaterSurfaceIndex,
  buildWaterSurfaceTileIndex,
  clampsDryShoreDepth,
  drawnWaterLevelAt,
  SHORE_SLOPE_SAMPLE_HALF_WIDTH,
  shoreDepthAt,
  shoreDepthAttribute,
  shoreSlopeAt,
  WATER_SEABED_CLAMP_YARDS,
  type WaterGridRegion,
  waterSheetTilePlan,
} from './water_core';
import {
  coveredByOtherSheet,
  gapDryFraction,
  gapSheetWorthBuilding,
  gapsAdjacentTo,
  type WaterSheetRect,
  waterCoverageGaps,
  zoneSheetRects,
} from './water_coverage_core';
import { WaterSimulation, type WaterWaveUniforms } from './water_simulation';
import { zoneBuildPool } from './zone_build_pool';

// Water for the whole zone strip.
//
// Shader tiers (medium and up): one shared ShaderMaterial over a fine sheet per
// zone (so off-screen zones frustum cull away) plus the horizon apron, each
// carrying a CPU-baked per-vertex shore depth, seabed slope and displacement
// gate. The surface itself is the FFT ocean in ocean/: a Tessendorf simulation
// over a few cascades (ocean_simulation.ts) displaces the sheets and drives a
// physically based surface (ocean_surface_glsl.ts) that reflects a live cube
// capture of the sky dome (sky_probe.ts), glitters with roughness the spectrum
// itself supplies, and on the tiers whose post chain captures the opaque scene
// (scene_sampling.ts) refracts, absorbs and lights the real seabed with
// caustics. This module keeps the GEOMETRY: which sheets exist, what they bake,
// how they cull, stream, refit and draw in order.
//
// On top of the simulated sea sits the interactive height field
// (water_simulation.ts): ONE camera-anchored window, not one field per lake,
// because this world's water is continuous (zone strips plus the horizon
// apron) and has no lake list to key fields off. Every water mesh shares one
// material, so the field's uniforms drive all of them by reference.
//
// Low tier keeps the legacy scrolling Phong plane, upgraded with the real
// swell normal map for textured speculars.

const SEGMENTS_PER_ZONE = 180; // ~2u vertex spacing, enough for the foam band
// The zone rects do not tile the world's bounding box, and every un-zoned cell
// used to be left to the horizon apron, whose cells are ~48 x 57 yards. That is
// fine over open ocean and wrong anywhere there is a coastline: interpolating
// depth, seabed slope, foam and alpha across a 48 yard triangle draws hard
// wedges and diagonal colour steps. So a cell with a real coastline gets the
// SAME fine sheet a zone does. But an un-zoned cell that is almost all open sea
// (the southwest corner, x -540..-180 by z -180..180, is a ~1% dry sliver at the
// vale headland's west flank in a 360x360yd rect) is worse off with a fine sheet
// than without: it bands over the apron. Which gaps actually build is decided by
// builtGapRects() from a terrain scan; see it and water_coverage_core.ts.
const WATER_ZONE_RECTS = zoneSheetRects(ZONES, STRIP_MIN_X, STRIP_MAX_X);
const WATER_GAP_RECTS = waterCoverageGaps(
  ZONES,
  { minX: WORLD_MIN_X, maxX: WORLD_MAX_X, minZ: WORLD_MIN_Z, maxZ: WORLD_MAX_Z },
  STRIP_MIN_X,
  STRIP_MAX_X,
);
// terrainHeight is deliberately rich and sampling all 32k water vertices in
// one timer was a measured 170-260ms live-play freeze. Background zone loads
// fill a handful of rows per idle callback instead; four rows stay around the
// 6ms cooperative-work budget on the profiling machine.
const WATER_ROWS_PER_IDLE_SLICE = 4;
const WATER_IDLE_TIMEOUT_MS = 200;
const WATER_VERTEX_ROWS = Array.from({ length: SEGMENTS_PER_ZONE + 1 }, (_, row) => row);
// The apron runs UNDER every zone plane (0.02 lower). Neither writes depth (a
// floor mark a player reacts to must show through shallow water on every
// tier), so the depth buffer cannot arbitrate between them: the apron DISCARDS
// its pixels inside every built, visible sheet instead (its own material
// variant, ocean_material.ts `apron`), so the sea is shaded once per pixel and
// the sheet with the real shoreline always wins. Its paint order is still
// pinned under the sheets' (for the thin overlap strip along each sheet edge,
// and for the from-below ceilings, which copy these orders), because left to
// three.js's transparent sort the order would come from each object's
// bounding-sphere centre, and the apron's is a world-scale sheet near the
// origin, so merely orbiting the camera would reorder them. Floor marks start
// at 1, above both.
const WATER_APRON_RENDER_ORDER = -1;
const WATER_SURFACE_RENDER_ORDER = 0;
/**
 * How far inside a sheet's rect the apron starts discarding. The two surfaces
 * displace from different grids, so a seam exactly at the rect edge could
 * open a hairline crack; a strip of overlap closes it.
 */
const WATER_APRON_DISCARD_INSET = 1.5;

/**
 * The one shared, wrapped water clock every water material binds as uTime.
 * It wraps at OCEAN_LOOP_SECONDS so shader phases never grow unbounded; every
 * simulated wave (ocean_spectrum_core.ts) runs a whole number of cycles per
 * that period and every texture scroll in the surface shader a whole number of
 * tiles per it, so the wrap is seamless by construction.
 */
const WATER_TIME: THREE.IUniform<number> = { value: 0 };
/**
 * Seabed slope the horizon apron falls back to once it is far enough out that
 * terrain sampling is no longer trustworthy. Foam is depth/slope, so a small
 * slope against a deep reading puts it far past the surf band: open water,
 * never foam.
 */
const APRON_SHORE_SLOPE = 1;
/**
 * The apron is NOT a featureless sheet. It begins exactly where the zone planes
 * stop (the world is only WORLD_SIZE yards across, so that edge is a few dozen
 * yards offshore and squarely in view), and a constant deep reading there steps
 * against whatever the zone plane actually has, which is usually still shelf.
 * Measured off Eastbrook: 1.51 yards on the plane's last vertex against the
 * apron's 6, drawn as a ruler-straight line because a rectangle edge IS
 * straight. So the apron samples the SAME terrain function the zone planes do
 * and the two agree at the seam by construction rather than by tuning.
 */
const APRON_SEGMENTS = 192;
/**
 * How far outside the world the apron keeps trusting terrainHeight. It stays
 * sensible well past the edge (6 yards, the clamp, by 70 yards out) but turns
 * into another landmass eventually (-38 yards at 720 out), which would paint
 * dry land across the horizon. Fade to the constant deep sea before that.
 */
const APRON_TERRAIN_FADE_YARDS = 240;
/**
 * Blocks per axis the horizon apron is drawn in (see waterSheetTilePlan). The
 * apron is one sheet thousands of yards across and a horizontal sheet that big
 * is mostly out of view: at a typical field of view the visible wedge out to
 * the far plane is a small fraction of its area, but a single mesh's bounds
 * intersect the frustum from everywhere, so every kept triangle was submitted
 * every frame. Five per axis is the measured knee, over six ground cameras at
 * the ultra vista config (163,992 kept triangles in the whole apron):
 *
 *   per side |  blocks | avg draws | avg triangles submitted | worst camera
 *          3 |       9 |         5 |                  90,264 |      108,696
 *          4 |      16 |         8 |                  81,397 |      101,784
 *          5 |      25 |         9 |                  60,493 |       65,208
 *          6 |      36 |        13 |                  58,357 |       62,616
 *
 * Five costs one draw more than four and submits 21k fewer triangles, and it
 * is where the WORST camera stops being an outlier (65k against 102k): a
 * coarser split leaves one block straddling the view on some headings and
 * hands back most of the win. Six buys 2k more triangles for four more draws,
 * which is the wrong side of the trade when calls are a currency too. The
 * extra draws all share one program, one material and one set of vertex
 * buffers; only the index binding changes between them.
 */
const WATER_APRON_TILES_PER_SIDE = 5;

/**
 * The shader water needs no downloaded asset: its waves, foam and sky are all
 * built on the GPU (ocean/), so a failed fetch can never drop a player to the
 * Phong plane. Kept as the graphics-profile switch's preparer (it has nothing
 * to prepare).
 */
export function prepareWaterProfileAssets(_target: Readonly<GfxSettings>): Promise<void> {
  return Promise.resolve();
}

/** Always true: the shader tier reads no image asset (see above). */
export function hasWaterShaderAssets(): boolean {
  return true;
}

/**
 * Feather over which the zone planes fade their chop DISPLACEMENT to zero
 * approaching their rect edge, where the chop-free apron takes over. Wider
 * than the chop wavelengths' half-heights so the handoff has no visible knee.
 * Displacement only: the shading field is per-pixel and identical on both
 * sheets, so this feather never reaches a normal, a whitecap, or a glint.
 */
const WATER_CHOP_EDGE_FEATHER_YARDS = 14;
/**
 * Depth margin the horizon apron subtracts before its displacement gate opens
 * (see bakeSwellGate). Its cells are ~29 x 38 yards, so an offshore sandbar can
 * sit entirely BETWEEN four wet vertices, invisible to a grid minimum; one yard
 * of margin covers every such bar in the world. It costs nothing visible: the
 * shallowest fully-heaving apron vertex moves from 1.3 to about 3.4 yards of
 * depth, and inside the world rect the apron is under a near-opaque zone plane
 * there anyway. The zone planes take 0 at their 2 yard spacing, where the grid
 * already sees everything.
 */
const WATER_APRON_SWELL_GATE_MARGIN_YARDS = 1;
const WATER_PLANE_SWELL_GATE_MARGIN_YARDS = 0;
/** Sun-through-swell scattering tint: the turquoise a lit wave face glows. */
const SCATTER_COLOR = new THREE.Color(0.14, 0.64, 0.6);

const DEEP_COLOR = new THREE.Color(0x115898);
/** Canonical shallow-water tint, exported for surfaces that must match the
 *  sea palette without the full shader (the Wildheart waterfall ribbons). */
export const SHALLOW_COLOR = new THREE.Color(0x32d0cc);
const SKY_TINT = new THREE.Color(0xace0fa); // matches the sky horizon band
const SUN_COLOR = new THREE.Color(0xfff0d4);

/** The four water tones, sRGB hex (the palette lab's water row). */
export interface WaterPaletteHexes {
  deep: number;
  shallow: number;
  sky: number;
  scatter: number;
}
const WATER_STOCK = {
  deep: DEEP_COLOR.clone(),
  shallow: SHALLOW_COLOR.clone(),
  sky: SKY_TINT.clone(),
  scatter: SCATTER_COLOR.clone(),
};
/** The shipped water tones, for the palette lab's stock look. */
export function stockWaterPalette(): WaterPaletteHexes {
  return {
    deep: WATER_STOCK.deep.getHex(),
    shallow: WATER_STOCK.shallow.getHex(),
    sky: WATER_STOCK.sky.getHex(),
    scatter: WATER_STOCK.scatter.getHex(),
  };
}
/**
 * Palette lab: recolour every water surface at once (null hands the colours
 * back to each realm's own water character). The surface materials hold these
 * Color objects BY REFERENCE, so this is a uniform write, never a rebuild or a
 * relink.
 */
export function setWaterPalette(p: WaterPaletteHexes | null): void {
  // Each realm's own water character (ocean/water_character_core.ts) owns the
  // colours until a look applies a water row; the row then owns them all.
  OCEAN_PALETTE_OVERRIDE.value = p ? 1 : 0;
  if (!p) {
    DEEP_COLOR.copy(WATER_STOCK.deep);
    SHALLOW_COLOR.copy(WATER_STOCK.shallow);
    SKY_TINT.copy(WATER_STOCK.sky);
    SCATTER_COLOR.copy(WATER_STOCK.scatter);
    return;
  }
  DEEP_COLOR.setHex(p.deep);
  SHALLOW_COLOR.setHex(p.shallow);
  SKY_TINT.setHex(p.sky);
  SCATTER_COLOR.setHex(p.scatter);
}

// Live day/night inputs, shared BY REFERENCE across every water surface
// material (the overworld field plus the Wildheart pools), the same idiom as
// sharedUniforms.uTime: the renderer writes them once per frame and every
// surface follows. uSunDir starts at the fixed anchor and tracks the moving
// sun/moon key light once the cycle drives it; uDayNight is the day/night
// color multiplier ((1,1,1) = authored day), needed because this shader is
// unlit (baked palette + fog) and would otherwise stay day-bright at night.
const WATER_SUN_UNIFORM = { value: SUN_DIR.clone() };
const WATER_DAYNIGHT_UNIFORM = { value: new THREE.Vector3(1, 1, 1) };

/** Point the water glints along the live key-light direction (sun by day,
 *  moon by night); the renderer calls this from its key-light update. */
export function setWaterSunDirection(dir: THREE.Vector3): void {
  WATER_SUN_UNIFORM.value.copy(dir);
}

/** Apply the day/night color multiplier to every water surface. */
export function setWaterDayNight(mul: readonly [number, number, number]): void {
  WATER_DAYNIGHT_UNIFORM.value.set(mul[0], mul[1], mul[2]);
}

export interface WaterView {
  group: THREE.Group;
  meshes: THREE.Mesh[];
  ensureZone(zone: ZoneDef, opts?: { pace?: 'fast' | 'idle' }): Promise<THREE.Mesh[]>;
  isZoneLoaded(zoneId: string): boolean;
  /**
   * Advances the wrapped water clock, the legacy texture scroll (low tier),
   * the interactive height field, and the from-below ceiling visibility
   * (cameraY against the waterline). Returns the simulation passes drawn
   * this frame, which the renderer folds into its draw-call accounting.
   */
  update(
    time: number,
    cameraX: number,
    cameraZ: number,
    visibleRange: number,
    cameraY?: number,
  ): number;
  /** Adds a local entry, landing, fish, or bobber disturbance. */
  addSplash(x: number, z: number, radius: number, strength?: number): void;
  /** Presses a facing-aligned body footprint into the surface. */
  enterContact(
    x: number,
    z: number,
    radius: number,
    halfLength: number,
    axisX: number,
    axisZ: number,
    strength?: number,
  ): void;
  /** Moves submerged volume from the previous footprint to the current one. */
  moveContact(
    oldX: number,
    oldZ: number,
    x: number,
    z: number,
    radius: number,
    halfLength: number,
    axisX: number,
    axisZ: number,
    strength?: number,
  ): void;
  /** Refills the final submerged footprint when a contact exits. */
  releaseContact(
    x: number,
    z: number,
    radius: number,
    halfLength: number,
    axisX: number,
    axisZ: number,
    strength?: number,
  ): void;
  /**
   * Player toggle for the interactive wake/ripple height field (the
   * `waterRipples` setting, threaded through Renderer.setWaterRipples because
   * render modules never read the settings store directly). While disabled the
   * contact feeds drop their impulses and update() draws no simulation passes;
   * disabling mid-wake puts the live field to sleep so the surface goes calm
   * instead of freezing a stale wake into the shader. The low tier has no
   * field at all, so there this is a no-op.
   */
  setWavesEnabled(enabled: boolean): void;
  /** One live from-below ceiling mesh (every underside shares its material),
   *  the root the underwater compile gate links; null on the Phong tier,
   *  which has no underside. */
  undersideRoot(): THREE.Object3D | null;
  /** Keep every underside hidden while held, whatever the camera does: the
   *  underwater compile gate holds them until their program has linked. */
  setUndersideHeld(held: boolean): void;
  /**
   * Editor-only: re-seat the surface at the ACTIVE waterLevel() and recompute
   * the per-vertex shore depth from the CURRENT terrainHeight (after a
   * water-level change or a sculpt near the shoreline). Updates the existing
   * geometry in place (no geometry is replaced, so nothing leaks); the low
   * Phong tier has no shore attribute and only repositions its one plane.
   */
  setLevel(): void;
  /**
   * Editor-only: the same shore re-bake as setLevel, but only for the sheet
   * vertices inside one edited rect (a sculpt stroke's bounds), plus the
   * whole-sheet swell gate and dry-tile cull re-derived from them. This is
   * what keeps the water in step with the terrain after every stroke: ground
   * lowered under the waterline gets its surface back instead of showing the
   * bare seabed (or the dark horizon apron) through a hole in the sea.
   */
  refreshRegion(minX: number, minZ: number, maxX: number, maxZ: number): void;
  /**
   * Releases the one water sheet built for `zoneId` (front mesh, its
   * underside twin, and their shared geometry; the surface material is
   * shared across every sheet and outlives this) and resets residency so a
   * later `ensureZone` for the same zone rebuilds from scratch. A no-op for
   * a zone with nothing built or with no water at all. Gap sheets (water
   * belonging to no zone) are left alone. Used only by the constrained-memory
   * zone-eviction pass (see zone_eviction_core.ts).
   */
  unloadZone(zoneId: string): void;
  /** Releases view-owned geometry, materials, and simulation targets. */
  dispose(): void;
}

/** True when a geometry's live index already holds exactly `next`. */
function sameIndexArray(current: THREE.BufferAttribute | null, next: ArrayLike<number>): boolean {
  if (!current || current.array.length !== next.length) return false;
  const a = current.array;
  for (let i = 0; i < next.length; i++) if (a[i] !== next[i]) return false;
  return true;
}

function disposeOwned(meshes: THREE.Mesh[]): void {
  const materials = new Set<THREE.Material>();
  for (const mesh of meshes) {
    mesh.geometry.dispose();
    const material = mesh.material;
    if (Array.isArray(material)) for (const entry of material) materials.add(entry);
    else materials.add(material);
  }
  for (const material of materials) material.dispose();
}

/** Inert wave uniforms for surfaces with no interactive height field (no
 *  renderer to run the simulation, or an interior pool outside its window). */
let zeroWaveTexture: THREE.DataTexture | null = null;
export function zeroWaveUniforms(): WaterWaveUniforms {
  if (!zeroWaveTexture) {
    zeroWaveTexture = new THREE.DataTexture(new Uint8Array(4), 1, 1);
    zeroWaveTexture.name = 'water-wave-calm';
    zeroWaveTexture.needsUpdate = true;
  }
  return {
    uWaveState: { value: zeroWaveTexture },
    uWaveEnabled: { value: 0 },
    uWaveOrigin: { value: new THREE.Vector2() },
    uWaveSize: { value: 1 },
  };
}

// The simulation the surfaces read. The active shader water publishes its
// own here; anything built without one (the editor, a unit test, a surface
// built before the world) draws a calm sea from the shared calm set.
let liveOcean: OceanSurfaceUniforms | null = null;
let calmOcean: OceanSurfaceUniforms | null = null;
function oceanForSurfaces(): OceanSurfaceUniforms {
  if (liveOcean) return liveOcean;
  calmOcean ??= calmOceanUniforms(3);
  return calmOcean;
}
// The sky reflection every surface reads, one object by reference.
const SKY_PROBE_UNIFORMS: OceanSkyUniforms = {
  uSkyProbe: { value: null },
  uSkyProbeLod: { value: 0 },
  uSkyProbeReady: { value: 0 },
};
const WATER_SHARED_UNIFORMS = {
  uSunDir: WATER_SUN_UNIFORM, // live key-light direction (shared by reference)
  uDayNight: WATER_DAYNIGHT_UNIFORM, // day/night multiplier (shared by reference)
  uTime: WATER_TIME,
  uSunColor: { value: SUN_COLOR },
  uSkyColor: { value: SKY_TINT },
  uDeep: { value: DEEP_COLOR },
  uShallow: { value: SHALLOW_COLOR },
  uScatter: { value: SCATTER_COLOR },
};

/**
 * The one overworld water surface material (the FFT ocean surface, see
 * ocean/). Exported so interior builders can draw the exact same surface;
 * geometry fed to it must carry aShoreDepth/aShoreSlope attributes (aSwellW
 * and aSwellGate are optional: a geometry that omits them reads 0 and stays
 * displacement-still, which is what an interior pool wants). Callers gate on
 * GFX.standardMaterials exactly like buildWater.
 *
 * `shoreEdgeFade` fades the surface to nothing where the baked depth reaches
 * zero, so the WATERLINE follows the terrain contour instead of the geometry
 * boundary (a define: off compiles the block out).
 */
export function createWaterSurfaceMaterial(
  wave: WaterWaveUniforms,
  opts?: { shoreEdgeFade?: boolean; underside?: boolean; apron?: OceanSheetRects },
): THREE.ShaderMaterial {
  return createOceanSurfaceMaterial(
    oceanForSurfaces(),
    SKY_PROBE_UNIFORMS,
    wave,
    WATER_SHARED_UNIFORMS,
    {
      ...opts,
      // The trace reads the opaque-scene capture, which only the AO (n8ao)
      // chains build; anywhere else it would compile for nothing.
      ssrSteps: GFX.ao ? (oceanWaterPlan()?.ssrSteps ?? 0) : 0,
    },
  );
}

/**
 * The simulation plan for this profile. A constrained-memory profile (an
 * Android phone on a shader tier) never runs more than the medium grids.
 */
function oceanWaterPlan() {
  const tier = GFX.constrainedMemory && GFX.waterTier !== 'low' ? 'medium' : GFX.waterTier;
  return oceanPlanForTier(tier);
}

/**
 * Bakes a sheet's shore attributes on the shared zone-build workers, in place.
 * Returns false when the caller must bake them on this thread instead (no
 * module workers, or the job failed): off-thread is a latency optimisation,
 * never a requirement.
 *
 * The vertex COORDINATES travel with the job rather than the rect: sampling the
 * positions the geometry actually carries is what makes the two paths agree bit
 * for bit (tests/terrain_chunk_worker.test.ts pins the equivalence).
 */
async function fillShoreOffThread(
  pos: THREE.BufferAttribute,
  shoreDepth: Float32Array,
  shoreSlope: Float32Array,
  seed: number,
  urgent: boolean,
): Promise<boolean> {
  const pool = zoneBuildPool();
  if (!pool) return false;
  const x = new Float32Array(pos.count);
  const z = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    x[i] = pos.getX(i);
    z[i] = pos.getZ(i);
  }
  const filled = await pool.fillWater({ x, z, seed, clampDry: clampsDryShoreDepth() }, { urgent });
  if (!filled) return false;
  shoreDepth.set(filled.shoreDepth);
  shoreSlope.set(filled.shoreSlope);
  return true;
}

function buildShaderWater(seed: number, renderer?: THREE.WebGLRenderer): WaterView {
  // legacy procedural maps still get generated (unused) to preserve the
  // shared-LCG call order in textures.ts for everything generated after
  waterNormalMaps();
  const simulation = renderer ? new WaterSimulation(renderer) : null;
  // The waterRipples setting, applied via setWavesEnabled. Starts true to
  // match the setting's default; the renderer syncs the persisted value right
  // after construction.
  let wavesEnabled = true;
  const wave = simulation ? simulation.uniforms : zeroWaveUniforms();
  // The FFT sea and the sky it reflects. Both need the world renderer; without
  // one (tests, a surface built for a thumbnail) the surface draws calm water.
  const plan = oceanWaterPlan();
  const ocean =
    renderer && plan ? new OceanSimulation(renderer, plan, DEFAULT_SEA_STATE, seed) : null;
  if (ocean?.enabled) liveOcean = ocean.uniforms;
  const probe = renderer && supportsSkyProbe(renderer) ? new SkyReflectionProbe(renderer) : null;
  // Each realm's water character follows the map that is loaded now.
  rebakeWaterCharacterField();
  if (probe) {
    SKY_PROBE_UNIFORMS.uSkyProbe.value = probe.target.texture;
    SKY_PROBE_UNIFORMS.uSkyProbeLod.value = probe.maxLod;
    SKY_PROBE_UNIFORMS.uSkyProbeReady.value = 0;
  }
  // ONE material for every zone plane, so the field's uniform objects (shared
  // by reference, like uTime) drive the whole surface; the apron's variant
  // shares every uniform object and adds only the sheet rects it discards in.
  const material = createWaterSurfaceMaterial(wave);
  const sheetRects: OceanSheetRects = {
    uSheetRects: {
      value: Array.from({ length: OCEAN_MAX_SHEET_RECTS }, () => new THREE.Vector4()),
    },
    uSheetRectCount: { value: 0 },
  };
  const apronMaterial = createWaterSurfaceMaterial(wave, { apron: sheetRects });
  const undersideMaterial = createWaterSurfaceMaterial(wave, { underside: true });
  // The depth-only twins (ocean_material.ts createOceanDepthMaterial): each
  // front sheet carries one as a CHILD, so it is compiled with the sheet's
  // own prepare, hides with it and leaves with it.
  const depthMaterial = createOceanDepthMaterial(oceanForSurfaces(), wave);
  const apronDepthMaterial = createOceanDepthMaterial(oceanForSurfaces(), wave, {
    apron: sheetRects,
  });
  // LIVENESS (ocean/water_liveness_core.ts): every water draw marks the frame,
  // and the simulation, the sky probe and the opaque-scene capture run only
  // while water has drawn recently, so a frame with no water pays for none.
  const liveness = createWaterLiveness();
  const markDrawn = (): void => {
    liveness.drawnSinceUpdate = true;
  };
  // The sheets the apron must not draw under: every built front sheet that is
  // visible (a sheet staged hidden for its prewarm must not leave a hole).
  const sheetFronts = new Set<THREE.Mesh>();
  const syncSheetRects = (): void => {
    let count = 0;
    for (const mesh of sheetFronts) {
      if (!mesh.visible || count >= OCEAN_MAX_SHEET_RECTS) continue;
      const box = mesh.geometry.boundingBox;
      if (!box) continue;
      sheetRects.uSheetRects.value[count].set(
        box.min.x + WATER_APRON_DISCARD_INSET,
        box.min.z + WATER_APRON_DISCARD_INSET,
        box.max.x - WATER_APRON_DISCARD_INSET,
        box.max.z - WATER_APRON_DISCARD_INSET,
      );
      count++;
    }
    sheetRects.uSheetRectCount.value = count;
  };
  // The opaque-scene capture (scene_sampling.ts) copies the scene's colour and
  // depth before the first transparent draw whenever a bound consumer is
  // visible; the front sheets bind while the water is live and release when it
  // is not, so a frame with no water on screen pays no copy.
  const fronts = new Set<THREE.Mesh>();
  const sceneBindings = new Map<THREE.Mesh, () => void>();
  let boundScene: THREE.Scene | null = null;
  const bindFronts = (live: boolean): void => {
    const parent = group.parent;
    const scene = live && parent instanceof THREE.Scene ? parent : null;
    if (scene !== boundScene) {
      for (const release of sceneBindings.values()) release();
      sceneBindings.clear();
      boundScene = scene;
    }
    if (!scene) return;
    for (const mesh of fronts) {
      if (sceneBindings.has(mesh)) continue;
      sceneBindings.set(
        mesh,
        bindSceneSamples(scene, mesh as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>),
      );
    }
  };
  const addFront = (mesh: THREE.Mesh, depth: THREE.ShaderMaterial): void => {
    fronts.add(mesh);
    mesh.onBeforeRender = markDrawn;
    const twin = new THREE.Mesh(mesh.geometry, depth);
    twin.name = 'water-depth';
    twin.renderOrder = OCEAN_DEPTH_RENDER_ORDER;
    mesh.add(twin);
  };
  const dropFront = (mesh: THREE.Mesh): void => {
    fronts.delete(mesh);
    sceneBindings.get(mesh)?.();
    sceneBindings.delete(mesh);
  };

  const meshes: THREE.Mesh[] = [];
  const group = new THREE.Group();
  group.name = 'water';
  // The from-below ceiling: a BackSide twin per sheet SHARING its geometry
  // (attributes, culled index and all), visible only while the camera is
  // under the waterline, so above water it costs nothing at all.
  const underPairs: { front: THREE.Mesh; under: THREE.Mesh }[] = [];
  let undersideHeld = false;
  const addUnderside = (front: THREE.Mesh): void => {
    const under = new THREE.Mesh(front.geometry, undersideMaterial);
    under.name = 'water-underside';
    under.renderOrder = front.renderOrder;
    under.onBeforeRender = markDrawn;
    under.position.copy(front.position);
    under.visible = false;
    group.add(under);
    meshes.push(under);
    underPairs.push({ front, under });
  };
  const loadedZones = new Set<string>();
  const pendingZones = new Map<string, Promise<THREE.Mesh[]>>();
  // The one front mesh ensureZone built for a given overworld zone (never a
  // gap sheet: gaps belong to no zone). Lets unloadZone find exactly the
  // mesh, underside twin and refit entry to release for that zone alone.
  const zoneFrontMesh = new Map<string, THREE.Mesh>();
  // Per-mesh in-place refit closures: re-seat y and recompute the shore-depth
  // attribute from the CURRENT terrain (build and setLevel share them). The
  // vertices never move (only the attribute + the mesh transform change), so
  // the baked bounding volumes stay valid. `mesh` is null for the apron (it
  // spans the whole map and is never released); every other entry carries the
  // front mesh its closure refits, so unloadZone can find and drop just one.
  // `refitRegion` is the same refit over one edited rect only (a sculpt
  // stroke): it re-samples just the vertices whose ground can have moved, then
  // re-derives the cheap whole-sheet passes (swell gate, dry-tile cull) from
  // the updated attribute, so newly flooded ground gets water and newly
  // raised ground drops it without the full 32k-vertex bake.
  const refits: {
    mesh: THREE.Mesh | null;
    refit: () => void;
    refitRegion: (minX: number, minZ: number, maxX: number, maxZ: number) => void;
  }[] = [];
  // The apron: one huge deep-sea sheet running far past every map edge, so
  // looking off the world's side reads as open ocean to the horizon, never
  // a water plane ending in mid-air. It sits a hair below the zone planes
  // (no z-fight) and carries a constant deep shore attribute. Its reach must
  // beat the view envelope from ANY camera position or its rim shows as a
  // line against the sky; the vista tiers (whose outdoor fog is gone) open
  // that envelope well past the classic view, so the apron grows with the
  // tier plan, with extra segments so coastal cells stay fade-band sized.
  {
    const vista = activeFarFieldPolicy().vista;
    const reach = vista.enabled ? WORLD_MAX_X + vista.envelopeFar + 400 : 0;
    const width = vista.enabled ? reach * 2 : 3000;
    const span = WORLD_MAX_Z - WORLD_MIN_Z + (vista.enabled ? reach * 2 : 2400);
    const apronSegments = vista.enabled ? 288 : APRON_SEGMENTS;
    const geo = new THREE.PlaneGeometry(width, span, apronSegments, apronSegments).rotateX(
      -Math.PI / 2,
    );
    geo.translate(0, 0, (WORLD_MIN_Z + WORLD_MAX_Z) / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const deep = new Float32Array(pos.count);
    const apronSlope = new Float32Array(pos.count);
    // The FULL world rect, side columns included: WORLD_MAX_X, never
    // WORLD_SIZE / 2 (that is one column's half-width, 180, and clamping the
    // terrain sample there treated the whole east and west columns as open
    // ocean: their real 0.8 to 2.2 yard shelves met a constant 6 yard apron
    // at a ruler-straight 23 to 30 percent luma step along the outer coasts).
    const half = WORLD_MAX_X;
    const edgeDepthCache = new Map<string, number>();
    // Distance OUTSIDE the world rect: 0 anywhere the zone planes cover.
    const outsideWorld = (x: number, z: number): number =>
      Math.max(0, Math.abs(x) - half, z - WORLD_MAX_Z, WORLD_MIN_Z - z);
    const fillApronVertex = (i: number): void => {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const outside = outsideWorld(x, z);
      // The apron is thousands of yards across and the world is 360, so the
      // vast majority of vertices are far outside and need no sampling at
      // all. Skipping them is what keeps this bake cheap enough to run
      // inline: terrainHeight is deliberately rich and shoreSlopeAt costs
      // four samples of it.
      if (outside >= APRON_TERRAIN_FADE_YARDS) {
        deep[i] = WATER_SEABED_CLAMP_YARDS;
        apronSlope[i] = APRON_SHORE_SLOPE;
        return;
      }
      const t = outside / APRON_TERRAIN_FADE_YARDS;
      const toConstant = t * t * (3 - 2 * t); // smoothstep, flat at both ends
      // Sample the nearest point INSIDE the world, never past it. Inside, that
      // is the vertex itself, so the apron reads the exact function the zone
      // planes read and the seam closes by construction. Outside, it extends
      // the coast's own depth and fades to open sea. Sampling the real
      // terrain out there instead looks tempting and is wrong: it is another
      // landmass (measured -518 yards, i.e. dry ground), so it would paint
      // land and surf across the open horizon.
      // Every vertex on a ray heading straight out of one edge clamps to the
      // SAME boundary point, so the samples collapse heavily. Memoize them.
      const cx = Math.min(half, Math.max(-half, x));
      const cz = Math.min(WORLD_MAX_Z, Math.max(WORLD_MIN_Z, z));
      const key = `${cx},${cz}`;
      let edgeDepth = edgeDepthCache.get(key);
      if (edgeDepth === undefined) {
        edgeDepth = shoreDepthAt(cx, cz, seed);
        edgeDepthCache.set(key, edgeDepth);
      }
      const carried =
        outside > 0
          ? Math.max(edgeDepth, 0)
          : shoreDepthAttribute(edgeDepth, clampsDryShoreDepth());
      deep[i] = carried * (1 - toConstant) + WATER_SEABED_CLAMP_YARDS * toConstant;
    };
    // Slope is the GRADIENT of the depth just filled, so take it by finite
    // difference on the grid instead of calling shoreSlopeAt: that costs four
    // more terrainHeight samples per vertex and terrainHeight is the
    // expensive part. It cannot be dropped for a constant either: the shader
    // reads foam as depth/slope, and a constant slope of 1 against the real
    // shelf depths out here (~1.5 yards) lands inside the surf band and would
    // paint foam across open water.
    const fillApronSlope = (): void => {
      const columns = apronSegments + 1;
      const dx = (2 * width) / apronSegments;
      const dz = (2 * span) / apronSegments;
      for (let i = 0; i < pos.count; i++) {
        const row = Math.floor(i / columns);
        const col = i % columns;
        const west = col > 0 ? deep[i - 1] : deep[i];
        const east = col < columns - 1 ? deep[i + 1] : deep[i];
        const north = row > 0 ? deep[i - columns] : deep[i];
        const south = row < columns - 1 ? deep[i + columns] : deep[i];
        // Never zero: the shader divides by this.
        apronSlope[i] = Math.max(Math.hypot((east - west) / dx, (south - north) / dz), 1e-4);
      }
    };
    const fillApron = (): void => {
      edgeDepthCache.clear();
      for (let i = 0; i < pos.count; i++) fillApronVertex(i);
      fillApronSlope();
    };
    // Region re-sample: only vertices whose terrain SAMPLE point (the vertex,
    // or its clamp onto the world rect) lies in the edited rect can change.
    const fillApronRegion = (minX: number, minZ: number, maxX: number, maxZ: number): boolean => {
      edgeDepthCache.clear();
      let touched = false;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const z = pos.getZ(i);
        if (outsideWorld(x, z) >= APRON_TERRAIN_FADE_YARDS) continue;
        const cx = Math.min(half, Math.max(-half, x));
        const cz = Math.min(WORLD_MAX_Z, Math.max(WORLD_MIN_Z, z));
        if (cx < minX || cx > maxX || cz < minZ || cz > maxZ) continue;
        fillApronVertex(i);
        touched = true;
      }
      if (touched) fillApronSlope();
      return touched;
    };
    fillApron();
    geo.setAttribute('aShoreDepth', new THREE.BufferAttribute(deep, 1));
    geo.setAttribute('aShoreSlope', new THREE.BufferAttribute(apronSlope, 1));
    // aSwellW 1 everywhere: the apron takes the long groundswell (its grid
    // samples those wavelengths cleanly) but NEVER the short chop: its ~27
    // yard vertex spacing cannot sample chop wavelengths (pure aliasing).
    // It is a DISPLACEMENT gate only. The fragment stage reads the clamped
    // weight, which is 1 here and 1 on every zone plane, so the two sheets
    // shade from the identical wave field and their shared rect edge carries
    // no step in normals, whitecaps, or glints.
    geo.setAttribute('aSwellW', new THREE.BufferAttribute(new Float32Array(pos.count).fill(1), 1));
    // The LIVE segment count, never APRON_SEGMENTS: the vista tiers build a
    // denser apron, and a gate computed over the wrong grid dimensions reads
    // the wrong neighbours (the same class of bug commit 032ee377d fixed in
    // cullApron).
    const apronColumns = apronSegments + 1;
    const apronGate = bakeSwellGate(
      deep,
      apronColumns,
      apronColumns,
      WATER_APRON_SWELL_GATE_MARGIN_YARDS,
    );
    geo.setAttribute('aSwellGate', new THREE.BufferAttribute(apronGate, 1));
    const refitApronGate = (): void => {
      apronGate.set(
        bakeSwellGate(deep, apronColumns, apronColumns, WATER_APRON_SWELL_GATE_MARGIN_YARDS),
      );
      (geo.attributes.aSwellGate as THREE.BufferAttribute).needsUpdate = true;
    };
    // ONE VERTEX BUFFER, MANY DRAWABLE BLOCKS. The apron reaches thousands of
    // yards past the map on the vista tiers, so a single mesh's bounding
    // volume intersects the frustum from every camera in the world and the
    // whole kept sheet is submitted every frame, most of it behind or beside
    // the view. Each block below is its own THREE.Mesh over the SAME attribute
    // buffers with its own index and its own bounds, so three.js culls the
    // blocks that are out of view and the frame pays for the wedge that is in
    // it. The triangle set is identical: waterSheetTilePlan partitions the
    // quads, it never re-samples anything, and every block shares the one
    // material, so the split costs state changes, not programs.
    const tilePlan = waterSheetTilePlan(apronColumns, apronColumns, WATER_APRON_TILES_PER_SIDE);
    // Y half-extent the swell can lift a block's surface by, over the flat
    // waterline. Deliberately generous against the real ceiling (chop plus
    // groundswell plus wobble plus the height field's 0.65 clamp): a bound too
    // TIGHT culls a block that is actually on screen, which reads as a hole in
    // the ocean, and a bound too loose only ever costs a draw.
    const APRON_TILE_Y_MARGIN = 4;
    const apronTiles: {
      mesh: THREE.Mesh;
      geometry: THREE.BufferGeometry;
      region: WaterGridRegion;
    }[] = [];
    for (const region of tilePlan) {
      const index = buildWaterSurfaceTileIndex(deep, apronColumns, region);
      const tileGeo = new THREE.BufferGeometry();
      // The SAME BufferAttribute objects, never copies: one upload feeds every
      // block, and the refit below writes through all of them at once.
      for (const [name, attribute] of Object.entries(geo.attributes)) {
        tileGeo.setAttribute(name, attribute as THREE.BufferAttribute);
      }
      tileGeo.setIndex(new THREE.BufferAttribute(index, 1));
      // Bounds from the block's own corner vertices. computeBoundingBox would
      // read the whole shared position attribute and hand every block the full
      // sheet's bounds, which is exactly the culling this split exists for.
      const x0 = pos.getX(region.row0 * apronColumns + region.col0);
      const x1 = pos.getX(region.row0 * apronColumns + region.col1);
      const z0 = pos.getZ(region.row0 * apronColumns + region.col0);
      const z1 = pos.getZ(region.row1 * apronColumns + region.col0);
      tileGeo.boundingBox = new THREE.Box3(
        new THREE.Vector3(Math.min(x0, x1), -APRON_TILE_Y_MARGIN, Math.min(z0, z1)),
        new THREE.Vector3(Math.max(x0, x1), APRON_TILE_Y_MARGIN, Math.max(z0, z1)),
      );
      tileGeo.boundingSphere = new THREE.Sphere();
      tileGeo.boundingBox.getBoundingSphere(tileGeo.boundingSphere);
      const tile = new THREE.Mesh(tileGeo, apronMaterial);
      tile.position.y = waterLevel() - 0.02;
      tile.renderOrder = WATER_APRON_RENDER_ORDER;
      // A block with no wet quad at all (buried under the world's land, or off
      // the map's own water entirely) is HIDDEN, not skipped: it costs no draw
      // while it is dry, and an editor water-level rise can bring it back
      // without the mesh list, the underside pairs or the refit closures
      // changing shape underneath everything that already holds them.
      tile.visible = index.length > 0;
      meshes.push(tile);
      group.add(tile);
      addFront(tile, apronDepthMaterial);
      addUnderside(tile);
      apronTiles.push({ mesh: tile, geometry: tileGeo, region });
    }
    const recullApron = (): void => {
      // The LIVE segment count, never the APRON_SEGMENTS constant: the vista
      // tiers build a denser apron (288), and a cull index computed over the
      // wrong grid dimensions keeps and drops the wrong triangles (seen live
      // as hard dark wedges and stray slivers along the coast). The block
      // partition is fixed, so a re-cull only re-emits each block's own index
      // and re-decides whether it has anything to draw: a level change that
      // floods a dry block has to bring it back, or the editor leaves a hole
      // in the new sea.
      for (const tile of apronTiles) {
        const index = buildWaterSurfaceTileIndex(deep, apronColumns, tile.region);
        tile.mesh.visible = index.length > 0;
        // Unchanged blocks keep their live buffer (a stroke touches a few).
        if (sameIndexArray(tile.geometry.getIndex(), index)) continue;
        tile.geometry.setIndex(new THREE.BufferAttribute(index, 1));
      }
    };
    refits.push({
      mesh: null,
      refit: () => {
        fillApron();
        (geo.attributes.aShoreDepth as THREE.BufferAttribute).needsUpdate = true;
        (geo.attributes.aShoreSlope as THREE.BufferAttribute).needsUpdate = true;
        refitApronGate();
        recullApron();
        for (const tile of apronTiles) tile.mesh.position.y = waterLevel() - 0.02;
      },
      refitRegion: (minX, minZ, maxX, maxZ) => {
        if (!fillApronRegion(minX, minZ, maxX, maxZ)) return;
        (geo.attributes.aShoreDepth as THREE.BufferAttribute).needsUpdate = true;
        (geo.attributes.aShoreSlope as THREE.BufferAttribute).needsUpdate = true;
        refitApronGate();
        recullApron();
      },
    });
    // The source geometry only ever carried the shared attributes; the blocks
    // own the draws, so it holds no index of its own and is never rendered.
    geo.setIndex(null);
  }
  // Coarse wetness scan: samples the zone rect on a 3-vertex stride (about 6
  // yards) and reports whether ANY sample is submerged. A fully dry zone then
  // skips the whole 181-row fill, the single biggest term in a background
  // zone prepare. The stride is safely below the smallest authored water body
  // (the border meres); a body would have to be under two strides across in
  // BOTH axes to slip through.
  const WETNESS_SCAN_STRIDE = 3;
  /**
   * One coarse pass over a sheet rect reporting whether it holds water at all
   * and whether it holds dry ground too (so a coastline runs through it).
   *
   * A ZONE builds its plane on `wet` alone, unchanged. A GAP builds only when
   * it also has land: a gap that is open water end to end has no shore to
   * resolve, and there the apron's constant deep reading is exactly right, so a
   * 32k vertex sheet over it would be pure cost. That is the rule the apron is
   * actually valid under, stated once rather than tuned per map.
   */
  const scanRect = async (
    rect: WaterSheetRect,
    idlePace: boolean,
  ): Promise<{ wet: boolean; dry: boolean }> => {
    const step = ((rect.xMax - rect.xMin) / SEGMENTS_PER_ZONE) * WETNESS_SCAN_STRIDE;
    const zStep = ((rect.zMax - rect.zMin) / SEGMENTS_PER_ZONE) * WETNESS_SCAN_STRIDE;
    let sincePause = 0;
    let wet = false;
    let dry = false;
    for (let z = rect.zMin; z <= rect.zMax; z += zStep) {
      for (let x = rect.xMin; x <= rect.xMax; x += step) {
        if (shoreDepthAt(x, z, seed) > 0) wet = true;
        else dry = true;
      }
      if (wet && dry) return { wet, dry };
      if (idlePace && ++sincePause >= WATER_ROWS_PER_IDLE_SLICE) {
        sincePause = 0;
        await idleSlot(WATER_IDLE_TIMEOUT_MS);
      }
    }
    return { wet, dry };
  };
  /**
   * Which gap rects actually get a fine sheet. A gap sheet exists to resolve a
   * COASTLINE no zone owns, but a rect that is almost all open sea (the un-zoned
   * southwest corner is a ~1% dry sliver at the vale headland's west flank in a
   * 360x360yd rect) has no meaningful shore: a fine sheet there interpolates its
   * shore attribute across the open water and bands over the apron (the reported
   * Eastbrook "duplicated water layer"). Keep only gaps whose dry-land fraction
   * clears the threshold (gapSheetWorthBuilding, pure + tested in the core).
   *
   * This is the ONE decision point, so it drives BOTH which gap sheets are built
   * AND the chop-feather abutment set: a skipped gap then reads as apron across
   * an edge, and its neighbour zone feathers its chop to meet the apron there,
   * the way it did before gap sheets existed. Memoized: the coarse terrain scan
   * is paid once during the async zone load, not at module import (a full-res
   * scan of the gaps measured ~75ms) and not per build. The lattice and the
   * threshold both live in the core, so the guard measures what this decides.
   */
  let builtGapRectsMemo: WaterSheetRect[] | null = null;
  const builtGapRects = (): WaterSheetRect[] => {
    if (builtGapRectsMemo) return builtGapRectsMemo;
    builtGapRectsMemo = WATER_GAP_RECTS.filter((rect) =>
      gapSheetWorthBuilding(gapDryFraction(rect, (x, z) => shoreDepthAt(x, z, seed) <= 0)),
    );
    return builtGapRectsMemo;
  };
  /**
   * Build one fine water sheet over `rect`. Zone planes and gap sheets are the
   * same thing: the builder only ever needed the rectangle and an id, so both
   * kinds share every downstream contract (2 yard grid, baked shore attributes,
   * swell gate, dry-tile cull, underside twin, refit closure).
   */
  const buildSheet = async (
    rect: WaterSheetRect,
    opts: { slice: boolean; visible: boolean; requireShore: boolean },
  ): Promise<THREE.Mesh | null> => {
    const idlePace = opts.slice;
    const requireShore = opts.requireShore;
    const depth = rect.zMax - rect.zMin;
    // each plane covers its own rect: the side columns live at x beyond the
    // strip, and a strip-centered plane would leave their shores (and the
    // border meres straddling the column line) on the featureless apron with
    // no foam or shallow grading
    const x0 = rect.xMin;
    const x1 = rect.xMax;
    const scan = await scanRect(rect, idlePace);
    if (!scan.wet) return null;
    // A gap with ZERO dry ground is open water end to end; the apron owns it.
    // (Gaps that ARE dry but too open-sea-dominated to be worth a fine sheet are
    // already filtered out of builtGapRects before we get here; see there.)
    if (requireShore && !scan.dry) return null;
    const geo = new THREE.PlaneGeometry(
      x1 - x0,
      depth,
      SEGMENTS_PER_ZONE,
      SEGMENTS_PER_ZONE,
    ).rotateX(-Math.PI / 2);
    geo.translate((x0 + x1) / 2, 0, (rect.zMin + rect.zMax) / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const shoreDepth = new Float32Array(pos.count);
    const shoreSlope = new Float32Array(pos.count);
    // Swell DISPLACEMENT weight, packed (see WATER_VERT): 2 = groundswell +
    // chop inside the plane, feathering the chop share back to 1 (groundswell
    // only, the apron's constant) at the rect edge, so the two displaced
    // sheets agree exactly where they meet. The feather fires ONLY where the
    // neighbour across the edge really is the apron: an edge abutted by another zone
    // plane carries identical chop on both sides, and feathering there cut a
    // visible calm stripe down every internal border water (the column
    // straits, the row meres). Abutment is per COORDINATE, not per edge:
    // one edge can be sheet on part of its run and apron on the rest. Gap
    // sheets count here exactly like zone planes, or the new seam between a
    // zone and its gap neighbour grows that same stripe. Static per-vertex
    // geometry: bakes once.
    // Abutment set = zone planes + the gap sheets that actually build. A gap
    // whose sheet is skipped must NOT count here, or this zone would treat the
    // apron across that edge as a fine neighbour and skip the chop feather.
    const sheetRects = [...WATER_ZONE_RECTS, ...builtGapRects()];
    const otherSheetCovers = (px: number, pz: number): boolean =>
      coveredByOtherSheet(sheetRects, rect.id, px, pz);
    const swellW = new Float32Array(pos.count);
    const probe = 0.5;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      let edge = Number.POSITIVE_INFINITY;
      if (!otherSheetCovers(x0 - probe, z)) edge = Math.min(edge, x - x0);
      if (!otherSheetCovers(x1 + probe, z)) edge = Math.min(edge, x1 - x);
      if (!otherSheetCovers(x, rect.zMin - probe)) edge = Math.min(edge, z - rect.zMin);
      if (!otherSheetCovers(x, rect.zMax + probe)) edge = Math.min(edge, rect.zMax - z);
      swellW[i] =
        1 +
        (edge === Number.POSITIVE_INFINITY
          ? 1
          : Math.min(1, Math.max(0, edge / WATER_CHOP_EDGE_FEATHER_YARDS)));
    }
    const columns = SEGMENTS_PER_ZONE + 1;
    const fillRow = (row: number): void => {
      const start = row * columns;
      const end = Math.min(pos.count, start + columns);
      for (let i = start; i < end; i++) {
        shoreDepth[i] = shoreDepthAttribute(
          shoreDepthAt(pos.getX(i), pos.getZ(i), seed),
          clampsDryShoreDepth(),
        );
        shoreSlope[i] = shoreSlopeAt(pos.getX(i), pos.getZ(i), seed);
      }
    };
    const fill = (): void => {
      for (const row of WATER_VERTEX_ROWS) fillRow(row);
    };
    // Off-thread first on BOTH paces: this is the single biggest term in a zone
    // prepare (32k vertices x shoreDepthAt + shoreSlopeAt, measured at 1.3 to
    // 1.7 s), and it is pure arithmetic, so it belongs on the shared zone-build
    // workers. The row slicing below stays for the fallback, which is what runs
    // wherever module workers are unavailable or the job failed.
    if (!(await fillShoreOffThread(pos, shoreDepth, shoreSlope, seed, !idlePace))) {
      if (idlePace) {
        await runIdleQueue(WATER_VERTEX_ROWS, fillRow, {
          batchSize: WATER_ROWS_PER_IDLE_SLICE,
          timeoutMs: WATER_IDLE_TIMEOUT_MS,
        });
      } else {
        fill();
      }
    }
    geo.setAttribute('aShoreDepth', new THREE.BufferAttribute(shoreDepth, 1));
    geo.setAttribute('aShoreSlope', new THREE.BufferAttribute(shoreSlope, 1));
    geo.setAttribute('aSwellW', new THREE.BufferAttribute(swellW, 1));
    const planeGate = bakeSwellGate(
      shoreDepth,
      columns,
      SEGMENTS_PER_ZONE + 1,
      WATER_PLANE_SWELL_GATE_MARGIN_YARDS,
    );
    geo.setAttribute('aSwellGate', new THREE.BufferAttribute(planeGate, 1));
    const refitPlaneGate = (): void => {
      planeGate.set(
        bakeSwellGate(
          shoreDepth,
          columns,
          SEGMENTS_PER_ZONE + 1,
          WATER_PLANE_SWELL_GATE_MARGIN_YARDS,
        ),
      );
      (geo.attributes.aSwellGate as THREE.BufferAttribute).needsUpdate = true;
    };
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    // Dry-tile culling: most of a zone rect is land, and every quad buried
    // under it still cost full vertex shading. Keeping only waterline-adjacent
    // tiles is the single biggest water frame-cost win in this module.
    const fullIndex = geo.getIndex();
    const cullZone = (): void => {
      const culled = buildWaterSurfaceIndex(shoreDepth, columns, SEGMENTS_PER_ZONE + 1);
      const next = culled ?? fullIndex?.array;
      // A stroke far from the waterline leaves the kept set as it was: keep
      // the live buffer rather than churning a fresh upload per stroke.
      if (next && sameIndexArray(geo.getIndex(), next)) return;
      geo.setIndex(culled ? new THREE.BufferAttribute(culled, 1) : fullIndex);
    };
    cullZone();
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.y = waterLevel();
    mesh.renderOrder = WATER_SURFACE_RENDER_ORDER;
    // The renderer compiles a background zone's material while this mesh is
    // hidden, then reveals it. Adding it visible here lets the next rAF draw
    // (and synchronously upload/link) it before prepareZoneAt can prewarm it.
    // A gap sheet passes visible:true regardless: it is never awaited by a
    // prepare, so nothing would ever reveal it, and it shares the one water
    // material the apron has been drawing with since construction, so there is
    // no unlinked program for a live frame to race.
    mesh.visible = opts.visible;
    meshes.push(mesh);
    group.add(mesh);
    addFront(mesh, depthMaterial);
    sheetFronts.add(mesh);
    addUnderside(mesh);
    refits.push({
      mesh,
      refit: () => {
        fill();
        (geo.attributes.aShoreDepth as THREE.BufferAttribute).needsUpdate = true;
        (geo.attributes.aShoreSlope as THREE.BufferAttribute).needsUpdate = true;
        refitPlaneGate();
        cullZone();
        mesh.position.y = waterLevel();
      },
      refitRegion: (minX, minZ, maxX, maxZ) => {
        if (maxX < x0 || minX > x1 || maxZ < rect.zMin || minZ > rect.zMax) return;
        let touched = false;
        for (let i = 0; i < pos.count; i++) {
          const x = pos.getX(i);
          const z = pos.getZ(i);
          if (x < minX || x > maxX || z < minZ || z > maxZ) continue;
          shoreDepth[i] = shoreDepthAttribute(shoreDepthAt(x, z, seed), clampsDryShoreDepth());
          shoreSlope[i] = shoreSlopeAt(x, z, seed);
          touched = true;
        }
        if (!touched) return;
        (geo.attributes.aShoreDepth as THREE.BufferAttribute).needsUpdate = true;
        (geo.attributes.aShoreSlope as THREE.BufferAttribute).needsUpdate = true;
        refitPlaneGate();
        cullZone();
      },
    });
    return mesh;
  };
  return {
    group,
    meshes,
    ensureZone(zone: ZoneDef, opts?: { pace?: 'fast' | 'idle' }): Promise<THREE.Mesh[]> {
      if (loadedZones.has(zone.id)) return Promise.resolve([]);
      const pending = pendingZones.get(zone.id);
      if (pending) return pending;
      const idlePace = opts?.pace === 'idle';
      const scheduled = idlePace
        ? idleSlot(WATER_IDLE_TIMEOUT_MS)
        : new Promise<void>((resolve) => setTimeout(resolve, 0));
      const zoneRect =
        WATER_ZONE_RECTS.find((r) => r.id === zone.id) ??
        ({
          id: zone.id,
          xMin: zone.xMin ?? -WORLD_SIZE / 2,
          xMax: zone.xMax ?? WORLD_SIZE / 2,
          zMin: zone.zMin,
          zMax: zone.zMax,
        } satisfies WaterSheetRect);
      const task = scheduled
        .then(async () => {
          const mesh = await buildSheet(zoneRect, {
            slice: idlePace,
            visible: !idlePace,
            requireShore: false,
          });
          loadedZones.add(zone.id);
          if (mesh) zoneFrontMesh.set(zone.id, mesh);
          // Gap sheets belong to no zone, so nothing streams them. Build each
          // one alongside the first ADJACENT zone that prepares: the whole rule
          // stays inside this view (no renderer change) and a gap is ready
          // before the player can stand in a neighbouring zone and look at it.
          //
          // Deliberately NOT awaited, and always sliced. A gap is adjacent
          // water, never the zone being entered, so it must not hold the
          // loading screen: awaiting one on the gating prepare put its full
          // 32k-vertex terrain bake (~5 terrainHeight samples per vertex) in
          // front of first paint. Sliced and detached, it lands a moment later
          // over water the player has not reached yet.
          for (const gap of gapsAdjacentTo(builtGapRects(), zoneRect)) {
            if (loadedZones.has(gap.id)) continue;
            loadedZones.add(gap.id);
            void buildSheet(gap, { slice: true, visible: true, requireShore: true });
          }
          return mesh ? [mesh] : [];
        })
        .finally(() => pendingZones.delete(zone.id));
      pendingZones.set(zone.id, task);
      return task;
    },
    isZoneLoaded: (zoneId: string) => loadedZones.has(zoneId),
    update(
      _time: number,
      cameraX: number,
      cameraZ: number,
      _visibleRange?: number,
      cameraY = Number.POSITIVE_INFINITY,
    ): number {
      WATER_TIME.value = _time % OCEAN_LOOP_SECONDS;
      // THE CEILING FOLLOWS THE WATER THAT IS ACTUALLY THERE, not the global
      // constant. waterLevelAt is the SAME predicate the renderer's underwater
      // fog reads, so the two can no longer disagree about whether the camera
      // is submerged.
      //
      // The old test was `cameraY < waterLevel() + 1.1` on the GLOBAL level.
      // That is true anywhere the camera dips below the world waterline, INCLUDING
      // over ground that carries no water: waterLevelAt returns -Infinity off a
      // water body (and it is cell-quantized, so the beach right beside the surf
      // reads dry). A third-person boom sinking below the waterline while it
      // hangs over the sand therefore turned the near-opaque BackSide ceiling on
      // while the fog, reading the true surface, stayed OUTDOOR: a hard-edged
      // dark slab hung across an ordinary, clear, un-fogged night beach. That is
      // the reported "looking up out of the water" artifact, and it did not need
      // the camera to be in any water at all.
      //
      // The slack survives, and only the slack: over real water the surface is
      // displaced by the swell, so a camera just above the flat level can still
      // be under a passing crest, and the ceiling has to be available there.
      // Above the flat surface it costs nothing anyway (a BackSide sheet is
      // back-face culled from above until displacement lifts it over the eye),
      // and it must exceed the worst-case chop + groundswell + wobble lift.
      const surfaceY = drawnWaterLevelAt(cameraX, cameraY, cameraZ, seed);
      const under = cameraY < surfaceY + 1.1;
      for (const pair of underPairs) {
        pair.under.position.y = pair.front.position.y;
        pair.under.visible = !undersideHeld && under && pair.front.visible;
      }
      syncSheetRects();
      const live = advanceWaterLiveness(liveness, _time, group.visible);
      bindFronts(live.capture);
      let passes = 0;
      if (live.work) {
        // Back from an idle spell: the whole sky cube is stale, not one face.
        if (live.resumed) probe?.refreshAll();
        if (probe) {
          passes += probe.update();
          SKY_PROBE_UNIFORMS.uSkyProbeReady.value = probe.ready ? 1 : 0;
        }
        if (ocean) passes += ocean.update(_time);
      }
      if (!wavesEnabled) return passes;
      return passes + (simulation?.update(_time, cameraX, cameraZ) ?? 0);
    },
    addSplash(x: number, z: number, radius: number, strength = 1): void {
      if (!wavesEnabled) return;
      simulation?.addSplash(x, z, radius, strength);
    },
    enterContact(
      x: number,
      z: number,
      radius: number,
      halfLength: number,
      axisX: number,
      axisZ: number,
      strength = 1,
    ): void {
      if (!wavesEnabled) return;
      simulation?.enterContact(x, z, radius, halfLength, axisX, axisZ, strength);
    },
    moveContact(
      oldX: number,
      oldZ: number,
      x: number,
      z: number,
      radius: number,
      halfLength: number,
      axisX: number,
      axisZ: number,
      strength = 1,
    ): void {
      if (!wavesEnabled) return;
      simulation?.moveContact(oldX, oldZ, x, z, radius, halfLength, axisX, axisZ, strength);
    },
    releaseContact(
      x: number,
      z: number,
      radius: number,
      halfLength: number,
      axisX: number,
      axisZ: number,
      strength = 1,
    ): void {
      if (!wavesEnabled) return;
      simulation?.releaseContact(x, z, radius, halfLength, axisX, axisZ, strength);
    },
    undersideRoot: () => underPairs[0]?.under ?? null,
    setUndersideHeld(held: boolean): void {
      if (held === undersideHeld) return;
      undersideHeld = held;
      if (held) for (const pair of underPairs) pair.under.visible = false;
    },
    setWavesEnabled(enabled: boolean): void {
      if (enabled === wavesEnabled) return;
      wavesEnabled = enabled;
      // A field that was mid-wake must actually go to sleep: reset() zeroes
      // uWaveEnabled and drops pending impulses, so the shader stops sampling
      // it this frame rather than holding the last wake forever.
      if (!enabled) simulation?.reset();
    },
    refreshRegion(minX: number, minZ: number, maxX: number, maxZ: number): void {
      // Widen by the shore-slope probe: a vertex just outside the edit reads
      // edited ground through its finite difference.
      const pad = SHORE_SLOPE_SAMPLE_HALF_WIDTH;
      for (const entry of refits) entry.refitRegion(minX - pad, minZ - pad, maxX + pad, maxZ + pad);
    },
    setLevel(): void {
      simulation?.reset();
      for (const entry of refits) entry.refit();
      // The refits re-seat the FRONT sheets only. An underside twin copies its
      // front's position once, at build, so without this every from-below
      // ceiling stays at the old waterline: after an editor level change the
      // surface you swim under sits yards away from the one you see from above.
      for (const pair of underPairs) pair.under.position.copy(pair.front.position);
    },
    unloadZone(zoneId: string): void {
      // See terrain.ts's unloadZone for why this guard exists: unreachable
      // today (a zone only becomes eligible for eviction once it is fully
      // prepared, by which point its build task has already resolved), kept
      // so the method stays safe to call in any state.
      if (pendingZones.has(zoneId)) return;
      const front = zoneFrontMesh.get(zoneId);
      loadedZones.delete(zoneId);
      if (!front) return;
      zoneFrontMesh.delete(zoneId);
      dropFront(front);
      sheetFronts.delete(front);
      const pairIndex = underPairs.findIndex((pair) => pair.front === front);
      const under = pairIndex === -1 ? null : underPairs[pairIndex].under;
      if (pairIndex !== -1) underPairs.splice(pairIndex, 1);
      for (const mesh of under ? [front, under] : [front]) {
        group.remove(mesh);
        const meshIndex = meshes.indexOf(mesh);
        if (meshIndex !== -1) meshes.splice(meshIndex, 1);
      }
      // under shares front's geometry (addUnderside), so dispose it once.
      front.geometry.dispose();
      const refitIndex = refits.findIndex((entry) => entry.mesh === front);
      if (refitIndex !== -1) refits.splice(refitIndex, 1);
    },
    dispose(): void {
      // Best effort, step by step: one throwing release must not leak the
      // render targets of the others.
      const steps: (() => void)[] = [
        () => {
          for (const mesh of [...fronts]) dropFront(mesh);
        },
        () => simulation?.dispose(),
        () => {
          if (ocean && liveOcean === ocean.uniforms) liveOcean = null;
          ocean?.dispose();
        },
        () => {
          if (probe && SKY_PROBE_UNIFORMS.uSkyProbe.value === probe.target.texture) {
            SKY_PROBE_UNIFORMS.uSkyProbe.value = null;
            SKY_PROBE_UNIFORMS.uSkyProbeReady.value = 0;
          }
          probe?.dispose();
        },
        () => disposeOwned(meshes),
        () => {
          depthMaterial.dispose();
          apronDepthMaterial.dispose();
        },
      ];
      for (const step of steps) {
        try {
          step();
        } catch (error) {
          console.warn('[water] dispose step failed', error);
        }
      }
    },
  };
}

function buildPhongWater(): WaterView {
  const tex = waterNormalish();
  const [norm] = waterNormalMaps();
  const mat = new THREE.MeshPhongMaterial({
    color: 0x1e98be,
    transparent: true,
    opacity: 0.78,
    shininess: 180,
    specular: 0xfff2d6,
    map: tex,
    normalMap: norm,
    normalScale: new THREE.Vector2(0.85, 0.85),
  });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uWocShallow = { value: SHALLOW_COLOR };
    sh.uniforms.uWocDeep = { value: DEEP_COLOR };
    sh.uniforms.uWocSky = { value: SKY_TINT };
    sh.uniforms.uWocSunCol = { value: SUN_COLOR };
    sh.uniforms.uWocSunDir = WATER_SUN_UNIFORM;
    sh.uniforms.uDayNight = WATER_DAYNIGHT_UNIFORM;
    sh.uniforms.uWocWaterTime = WATER_TIME;
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vWocWaterWPos;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vWocWaterWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vWocWaterWPos;
        uniform vec3 uWocShallow;
        uniform vec3 uWocDeep;
        uniform vec3 uWocSky;
        uniform vec3 uWocSunCol;
        uniform vec3 uWocSunDir;
        uniform vec3 uDayNight;
        uniform float uWocWaterTime;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        vec3 wocViewVec = cameraPosition - vWocWaterWPos;
        float wocDist = length(wocViewVec);
        vec3 wocV = wocViewVec / max(wocDist, 1e-4);
        float wocGraze = 1.0 - clamp(wocV.y, 0.0, 1.0);
        float wocFresnel = 0.08 + 0.92 * wocGraze * wocGraze * wocGraze;
        float wocDistW = smoothstep(14.0, 240.0, wocDist);
        float wocLane = sin(vWocWaterWPos.x * 0.045 + vWocWaterWPos.z * 0.038 + uWocWaterTime * 0.9)
          * cos(vWocWaterWPos.x * 0.028 - vWocWaterWPos.z * 0.052 - uWocWaterTime * 0.7) * 0.5 + 0.5;
        vec3 wocSeaCol = mix(uWocShallow, uWocDeep, clamp(wocDistW * 0.72 + wocLane * 0.24, 0.0, 1.0));
        wocSeaCol = mix(wocSeaCol, uWocSky, min(wocFresnel * 0.55, 0.38));
        diffuseColor.rgb = mix(diffuseColor.rgb * wocSeaCol * 1.35, wocSeaCol, 0.68);
        diffuseColor.a = clamp(mix(0.56, 0.88, clamp(wocDistW * 0.55 + wocFresnel * 0.45, 0.0, 1.0)), 0.0, 1.0);`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += mix(uWocShallow, uWocDeep, wocDistW) * uDayNight * 0.22;
        vec3 wocWaveN = normalize(vec3(
          sin(vWocWaterWPos.x * 1.3 + uWocWaterTime * 2.2) * 0.08,
          1.0,
          cos(vWocWaterWPos.z * 1.1 - uWocWaterTime * 1.9) * 0.08
        ));
        vec3 wocRefl = reflect(-normalize(uWocSunDir), wocWaveN);
        float wocGlint = exp2(48.0 * log2(max(dot(wocRefl, wocV), 1e-8)));
        totalEmissiveRadiance += uWocSunCol * uDayNight * wocGlint * 0.55;`,
      );
  };
  // low tier gets the same to-the-horizon apron by simply oversizing the
  // one plane (the tiled texture keeps its density via the repeat bump)
  const worldDepth = WORLD_MAX_Z - WORLD_MIN_Z + 2400;
  tex.repeat.set(240, 240);
  norm.repeat.set(210, 620);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(3000, worldDepth).rotateX(-Math.PI / 2), mat);
  mesh.position.set(0, waterLevel(), (WORLD_MIN_Z + WORLD_MAX_Z) / 2);
  const meshes = [mesh];
  const group = new THREE.Group();
  group.name = 'water';
  group.add(mesh);
  return {
    group,
    meshes,
    ensureZone: async () => [],
    isZoneLoaded: () => true,
    // The low tier has no height field at all: a Phong plane cannot sample one,
    // and the tier exists precisely to skip that GPU work.
    update(time: number): number {
      WATER_TIME.value = time % OCEAN_LOOP_SECONDS;
      tex.offset.x = time * 0.008;
      tex.offset.y = time * 0.011;
      norm.offset.x = time * 0.006;
      norm.offset.y = time * 0.009;
      return 0;
    },
    addSplash: () => {},
    enterContact: () => {},
    moveContact: () => {},
    releaseContact: () => {},
    setWavesEnabled: () => {},
    undersideRoot: () => null,
    setUndersideHeld: () => {},
    // One flat plane with no shore attribute or cull: nothing reads terrain.
    refreshRegion: () => {},
    setLevel(): void {
      for (const m of meshes) m.position.y = waterLevel();
    },
    // The low tier is one plane spanning the whole map, never per-zone
    // (isZoneLoaded is already unconditionally true), so there is nothing to
    // release here. iosMemoryProfile always forces this tier (gfx.ts's
    // standardMaterials), but a non-iOS constrainedMemory device can still
    // run the medium-plus shader path below, where per-zone sheets are real.
    unloadZone: () => {},
    dispose(): void {
      disposeOwned(meshes);
    },
  };
}

export function buildWater(seed: number, renderer?: THREE.WebGLRenderer): WaterView {
  return GFX.standardMaterials ? buildShaderWater(seed, renderer) : buildPhongWater();
}
