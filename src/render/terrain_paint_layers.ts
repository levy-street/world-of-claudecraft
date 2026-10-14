// The REAL painted ground textures, on the v0.35 splat pipeline.
//
// terrain_paint_tint.ts brought a map's paint layer back as vertex TINTS (the
// swatch colour over the nearest builtin splat layer), cobbles read as dark
// re-tinted rock, paving as pale rock, and none of the actual texture art the
// maker picked ever reached the screen. This module is the other half: the
// painted cells sample the swatch's ACTUAL texture in the splat fragment
// shader, so a boulevard painted Cobblestone001 finally shows cobblestones.
//
// Mechanism, kept deliberately small:
//
//   - a FIELD texture, one texel per paint cell: R = tile slot (255 = not
//     painted with a texture swatch), GBA = a tint ratio folding the swatch's
//     hue shift (colour vs the set's canonical average) and light slider;
//   - a TILE ARRAY (sampler2DArray, 512^2), one layer per distinct texture
//     the map's swatches reference, the shipped JPEGs for `builtin:` shas,
//     and the maker's own IMPORTED images (content-addressed sha256, stored
//     in IndexedDB by assets/ground_textures.ts) for everything else;
//   - the splat fragment takes four feathered taps of the field (the same
//     +-1.6yd diagonal the CPU bridge uses, so near-mesh and far-vista agree
//     about where paint fades) and REPLACES the splat albedo where painted.
//
// Snow-family swatches stay off this path on purpose: they already ride the
// shader's dedicated snow channel with real snow art. An imported texture
// whose bytes are not in this browser renders as its flat swatch colour (the
// layer is pre-filled with it), never as a foreign fallback texture.
//
// The state is rebuilt per terrain-view build (buildSplatMaterial calls
// paintLayerRuntime()); paint strokes and swatch sliders between builds go
// through refreshPaintFieldLive(), which rewrites the field/tile-size data IN
// PLACE while the slot set is unchanged and asks for a full rebuild when it
// is not (a new texture claims a slot the compiled material cannot hold).

import * as THREE from 'three';
import { getActiveWorldContent } from '../sim/data';
import { DEFAULT_PAINT_EDGE_DETAIL, DEFAULT_PAINT_EDGE_SOFTNESS } from '../sim/map_doc';
import type { BiomePaint, CustomPaintSwatch } from '../sim/types';
import { groundImageFor } from './assets/ground_textures';
import { assetUrl } from './assets/media';
import { SUN_DIR } from './gfx';
import { markPaintInterior } from './terrain_paint_interior_core';
import { terrainTexturePath, terrainTextureSet } from './terrain_texture_sets';

/** Fixed shader-side slot budget (uniform arrays need a constant size). Maps
 *  painting with more distinct texture sets keep the tint fallback for the
 *  overflow swatches. The editor's slots-full toast reads THIS constant. */
export const MAX_PAINT_SLOTS = 24;

const TILE_SIZE = 512;

export interface PaintLayerRuntime {
  /** cols x rows field; R slot, GBA tint ratio (byte 127.5 = 1.0). Null when
   *  the active content has no texture-swatch paint. */
  field: THREE.DataTexture | null;
  /** One layer per referenced texture, its flat swatch colour until (unless)
   *  the image lands. */
  tiles: THREE.DataArrayTexture | null;
  /** The matching NormalGL layers (neutral until each lands; imported
   *  textures ship no normal map and stay neutral), so painted ground keeps
   *  real relief instead of reading as a flat decal over the splat. */
  normTiles: THREE.DataArrayTexture | null;
  /** Anti-tiling amount per slot, 0..1 (0 = the plain repeat). */
  tileVar: Float32Array;
  /** Surface-depth amount per slot, 0..1 (0 = no AO tap at all). */
  tileDepth: Float32Array;
  /** The matching AmbientOcclusion layers (white until each lands). */
  aoTiles: THREE.DataArrayTexture | null;
  /** Measured mean of each slot's AO map, and 1/sd as a gain. The AO sheets
   *  in this library average 0.93 with a median sd of 0.041 (measured over
   *  all 66 of them), so the old fixed `0.42 + 0.78 * ao` curve brightened
   *  painted ground ~14% and modulated it by +-3% -- which is why Surface
   *  depth "added very little depth" (SPACEY, 2026-09-22). Normalising by each
   *  texture's OWN statistics makes the signal zero-mean and unit-variance,
   *  so one slider setting reads the same on a flat snow sheet (sd 0.008) and
   *  on paving stones (sd 0.130). Mean 1 / gain 0 until the image lands,
   *  which is exactly "no relief" for a missing AO map (white). */
  aoMean: Float32Array;
  aoGain: Float32Array;
  /** World-yards tiling period per slot. */
  tileSizes: Float32Array;
  /** originX, originZ, 1/cell, slotCount. */
  grid: THREE.Vector4;
  /** cols, rows. */
  dims: THREE.Vector2;
  /** Paint-edge look: x = boundary warp amplitude in YARDS, y = blend kernel
   *  half-width in CELLS (1 = the plain one-cell bilinear). */
  edge: THREE.Vector2;
  /** Shared uniform the async tile loads flip to 1 once every layer settled. */
  on: { value: number };
}

const EMPTY: PaintLayerRuntime = {
  field: null,
  tiles: null,
  normTiles: null,
  tileSizes: new Float32Array(MAX_PAINT_SLOTS),
  tileVar: new Float32Array(MAX_PAINT_SLOTS),
  tileDepth: new Float32Array(MAX_PAINT_SLOTS),
  aoTiles: null,
  aoMean: new Float32Array(MAX_PAINT_SLOTS).fill(1),
  aoGain: new Float32Array(MAX_PAINT_SLOTS),
  grid: new THREE.Vector4(0, 0, 0, 0),
  dims: new THREE.Vector2(1, 1),
  edge: new THREE.Vector2(0, 1),
  on: { value: 0 },
};

interface CacheEntry {
  paint: BiomePaint;
  runtime: PaintLayerRuntime;
  /** The slot->texture assignment the runtime was built with; a live refresh
   *  is only an in-place data rewrite while this is unchanged. */
  slotKeys: string[];
}

let cache: CacheEntry | null = null;

/** The tile-array key a swatch's texture rides, or null for the tint path.
 *  Builtin shas keep their set key (resolved from the bundle); imported
 *  textures use their content sha prefixed `sha:`. */
export function textureSlotSwatch(s: CustomPaintSwatch): string | null {
  const sha = s.textureSha;
  if (!sha) return null;
  if (sha.startsWith('builtin:')) {
    const key = sha.slice('builtin:'.length);
    if (/^Snow/i.test(key)) return null; // rides the dedicated snow channel
    return terrainTextureSet(key) ? key : null;
  }
  return `sha:${sha}`;
}

/** The map's texture-slot budget as the Studio shows it: planSlots' own count
 *  (one slot per DISTINCT texture, snow-family excluded), so the tally can
 *  never disagree with what renders. `over` swatch textures past the budget
 *  paint as their flat colour; the newest ones are the ones that miss out,
 *  since slots go in first-reference order. */
export interface PaintTextureSlotUsage {
  used: number;
  max: number;
  free: number;
  over: number;
}

export function paintTextureSlotUsage(
  swatches: readonly CustomPaintSwatch[],
): PaintTextureSlotUsage {
  const keys = new Set<string>();
  for (const s of swatches) {
    const key = textureSlotSwatch(s);
    if (key !== null) keys.add(key);
  }
  return {
    used: Math.min(keys.size, MAX_PAINT_SLOTS),
    max: MAX_PAINT_SLOTS,
    free: Math.max(0, MAX_PAINT_SLOTS - keys.size),
    over: Math.max(0, keys.size - MAX_PAINT_SLOTS),
  };
}

function byteRatio(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v * 127.5)));
}

/** Per-swatch tint ratio: the swatch colour against the set's canonical
 *  average, times the light slider, identity (1,1,1) for an untouched
 *  swatch, so the shipped art shows pure. An imported texture has no
 *  canonical average (its swatch colour IS the image's own mean), so only
 *  the light slider applies. */
function tintRatio(swatch: CustomPaintSwatch, setColor: number | null): [number, number, number] {
  const k = 1 + Math.max(-1, Math.min(1, swatch.light ?? 0));
  if (setColor === null) return [k, k, k];
  const ratio = (chSwatch: number, chSet: number): number => {
    const r = chSet > 0 ? chSwatch / chSet : 1;
    return Math.max(0.35, Math.min(2, r)) * k;
  };
  const sr = (swatch.color >> 16) & 0xff;
  const sg = (swatch.color >> 8) & 0xff;
  const sb = swatch.color & 0xff;
  const cr = (setColor >> 16) & 0xff;
  const cg = (setColor >> 8) & 0xff;
  const cb = setColor & 0xff;
  return [ratio(sr, cr), ratio(sg, cg), ratio(sb, cb)];
}

interface SlotPlan {
  slotKeys: string[];
  slotOfSwatchId: Map<number, number>;
  tintOfSwatchId: Map<number, [number, number, number]>;
  /** First swatch referencing each slot, for the pre-image flat fill. */
  swatchOfSlot: CustomPaintSwatch[];
}

/** Slots: one per DISTINCT texture, in first-reference order, capped at the
 *  shader budget (overflow swatches keep the tint fallback). */
function planSlots(paint: BiomePaint): SlotPlan {
  const slotOfKey = new Map<string, number>();
  const slotKeys: string[] = [];
  const slotOfSwatchId = new Map<number, number>();
  const tintOfSwatchId = new Map<number, [number, number, number]>();
  const swatchOfSlot: CustomPaintSwatch[] = [];
  for (const s of paint.custom ?? []) {
    const key = textureSlotSwatch(s);
    if (key === null) continue;
    let slot = slotOfKey.get(key);
    if (slot === undefined) {
      if (slotKeys.length >= MAX_PAINT_SLOTS) continue; // overflow keeps tint fallback
      slot = slotKeys.length;
      slotOfKey.set(key, slot);
      slotKeys.push(key);
      swatchOfSlot.push(s);
    }
    slotOfSwatchId.set(s.id, slot);
    const set = key.startsWith('sha:') ? null : terrainTextureSet(key);
    tintOfSwatchId.set(s.id, tintRatio(s, set ? set.color : null));
  }
  return { slotKeys, slotOfSwatchId, tintOfSwatchId, swatchOfSlot };
}

/** One texel per paint cell, written straight into `out`. */
/** Field R byte: bit 7 marks an INTERIOR cell (its eight neighbours carry the
 *  same swatch), the low bits the tile slot; 255 = not painted with a texture
 *  swatch. An interior fragment's 2x2 bilinear window is all one swatch, so
 *  the shader takes ONE field tap and ONE tile tap there and lands on the
 *  same colour the full four-tap blend would; only the edge band pays the
 *  feather. Most of a painted region is interior. */
export const PAINT_FIELD_INTERIOR_BIT = 128;

/** Amplitude ceilings for the two edge sliders at 100%, in world yards.
 *
 *  Sized against a ONE-YARD paint grid, which is what real maps use (the
 *  shipped Deepglass document is cell 1) -- the first cut of this was scaled
 *  for the 0.25yd floor, which left the softness slider clamped to "no change
 *  at all" for its bottom 40% and made the warp wander less than a single
 *  cell. Every yard of reach here is a yard the interior fast path gives up
 *  (see interiorRadiusCells), so they stop where the look stops improving. */
const MAX_EDGE_WARP_YD = 3;
const MAX_EDGE_SOFT_YD = 4;

/** The two edge sliders resolved against this grid's cell size. Yards, not
 *  cells, are the authored unit: a map at 0.25yd cells and one at 2yd cells
 *  must get the SAME boundary on screen. */
export function paintEdgeParams(paint: BiomePaint): {
  warpYd: number;
  spreadCells: number;
  radiusCells: number;
} {
  const detail = clamp01(paint.edgeDetail ?? DEFAULT_PAINT_EDGE_DETAIL);
  const soft = clamp01(paint.edgeSoftness ?? DEFAULT_PAINT_EDGE_SOFTNESS);
  const warpYd = detail * MAX_EDGE_WARP_YD;
  // >= 1: one cell is the narrowest kernel the 2x2 bilinear can express.
  const spreadCells = Math.max(1, (soft * MAX_EDGE_SOFT_YD) / paint.cell);
  // How far from the fragment the lookup can reach: the kernel's own span
  // plus whatever the warp displaces it by. The interior bit must be computed
  // over EXACTLY this radius or the one-tap fast path and the blended path
  // disagree, which draws a seam one kernel inside every painted region.
  const radiusCells = Math.max(1, Math.min(16, Math.ceil(spreadCells + warpYd / paint.cell)));
  return { warpYd, spreadCells, radiusCells };
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Mean and 1/sd of one decoded AO layer, written into the runtime's per-slot
 * arrays. The shader turns a tap into a zero-mean, unit-variance HEIGHT with
 * `(ao - mean) * gain`, which is what lets one Surface depth setting read the
 * same across a library whose AO contrast spans 16x (sd 0.008 on Snow003 to
 * 0.130 on PavingStones046).
 *
 * Every 4th byte, since the three colour channels of a greyscale AO jpeg are
 * identical and one channel is a 4x cheaper pass over a 512^2 tile.
 * The gain is capped: a near-flat sheet (sd 0.008) would otherwise amplify
 * its own JPEG ringing by 120x into visible blocking.
 */
export function measureAo(
  px: Uint8ClampedArray,
  slot: number,
  mean: Float32Array,
  gain: Float32Array,
  width = TILE_SIZE,
): void {
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let i = 0; i < px.length; i += 4) {
    const v = px[i] / 255;
    sum += v;
    sumSq += v * v;
    n++;
  }
  if (n === 0) return;
  const m = sum / n;
  const sd = Math.sqrt(Math.max(0, sumSq / n - m * m));
  mean[slot] = m;
  if (sd < 0.004) {
    gain[slot] = 0;
    return;
  }
  // JPEG BLOCK NOISE, the reason for the cap below.
  //
  // These sheets are 8x8-DCT jpegs, and normalising a LOW-CONTRAST one by 1/sd
  // amplifies its block seams right along with its relief. Measured at native
  // 1024: Cobblestone001 (sd 0.033) took gain 30.6 and drew a 1.5% shading step
  // at every block boundary, a grid of pale squares over the cobbles, while
  // PavingStones046 (sd 0.145, gain 6.9) stayed clean at 0.02%. That is exactly
  // what SPACEY reported, on exactly the two swatches he had at depth 1
  // (Warden Cobbles = Cobblestone001, Warden Tiles = Tiles001, blockiness 2.8
  // and 2.5).
  //
  // So measure the seam directly, mean |step| ACROSS 8px boundaries minus the
  // same within blocks, and cap the gain so what survives stays under
  // AO_SEAM_BUDGET of shading. WOC_PAINT_AO_LOD_BIAS has already attenuated the
  // 8px band by about AO_BLOCK_ATTEN before the height is used, so the cap is
  // computed against the attenuated seam rather than the raw one.
  //
  // MEASURE AT NATIVE RESOLUTION. An earlier pass measured a RESIZED copy, read
  // blockiness as ~1.0, and wrongly cleared this whole theory: resampling smears
  // the 8px grid, which is the one thing being looked for.
  const rows = Math.floor(n / width);
  let seamSum = 0;
  let seamN = 0;
  let innerSum = 0;
  let innerN = 0;
  for (let y = 0; y < rows; y++) {
    for (let x = 1; x < width; x++) {
      const d = Math.abs(px[(y * width + x) * 4] - px[(y * width + x - 1) * 4]) / 255;
      if (x % 8 === 0) {
        seamSum += d;
        seamN++;
      } else {
        innerSum += d;
        innerN++;
      }
    }
  }
  const excess = seamN > 0 && innerN > 0 ? Math.max(0, seamSum / seamN - innerSum / innerN) : 0;
  const attenuated = excess / AO_BLOCK_ATTEN;
  const noiseCap =
    attenuated > 1e-6 ? AO_SEAM_BUDGET / (attenuated * AO_STRONGEST_PASS) : MAX_AO_GAIN;
  gain[slot] = Math.min(1 / sd, noiseCap, MAX_AO_GAIN);
}

/** Ceiling on the AO normalisation gain. Was 55, which let the flattest sheets
 *  amplify pure compression noise; nothing in the library needs more to read. */
const MAX_AO_GAIN = 24;
/** Shading step a block seam may still produce (0.6%, below noticing). */
const AO_SEAM_BUDGET = 0.006;
/** The strongest pass the height feeds (the micro sun-shadow's amplitude):
 *  budget against that, not the gentler cavity. */
const AO_STRONGEST_PASS = 0.45;
/** How much WOC_PAINT_AO_LOD_BIAS attenuates the 8px band before it is used. */
const AO_BLOCK_ATTEN = 4;

function fillFieldData(paint: BiomePaint, plan: SlotPlan, out: Uint8Array): void {
  const { cols, rows, ids } = paint;
  for (let i = 0; i < ids.length; i++) {
    const slot = plan.slotOfSwatchId.get(ids[i]);
    const o = i * 4;
    if (slot === undefined) {
      out[o] = 255;
      out[o + 1] = 0;
      out[o + 2] = 0;
      out[o + 3] = 0;
      continue;
    }
    const tint = plan.tintOfSwatchId.get(ids[i])!;
    out[o] = slot;
    out[o + 1] = byteRatio(tint[0]);
    out[o + 2] = byteRatio(tint[1]);
    out[o + 3] = byteRatio(tint[2]);
  }
  // Second pass: the interior bit, over the whole box the shader's lookup can
  // reach (paintEdgeParams.radiusCells) rather than a fixed 3x3 -- see
  // markPaintInterior.
  markPaintInterior(
    ids,
    cols,
    rows,
    paintEdgeParams(paint).radiusCells,
    out,
    PAINT_FIELD_INTERIOR_BIT,
  );
}

function fillTileSizes(plan: SlotPlan, paint: BiomePaint, out: Float32Array): void {
  out.fill(6);
  for (const s of paint.custom ?? []) {
    const slot = plan.slotOfSwatchId.get(s.id);
    if (slot !== undefined && s.tileSize) out[slot] = s.tileSize;
  }
}

function fillTileVar(plan: SlotPlan, paint: BiomePaint, out: Float32Array): void {
  out.fill(0);
  for (const s of paint.custom ?? []) {
    const slot = plan.slotOfSwatchId.get(s.id);
    if (slot !== undefined && s.variation) out[slot] = s.variation;
  }
}

function fillTileDepth(plan: SlotPlan, paint: BiomePaint, out: Float32Array): void {
  out.fill(0);
  for (const s of paint.custom ?? []) {
    const slot = plan.slotOfSwatchId.get(s.id);
    if (slot !== undefined && s.depth) out[slot] = s.depth;
  }
}

/** Flat-fill one tile layer with a swatch's colour: what an imported texture
 *  shows until its bytes decode, and forever when they are not in this
 *  browser, its own colour, never a foreign texture. */
function fillLayerFlat(tileData: Uint8Array, slot: number, color: number): void {
  const layerBytes = TILE_SIZE * TILE_SIZE * 4;
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  const o0 = slot * layerBytes;
  for (let o = o0; o < o0 + layerBytes; o += 4) {
    tileData[o] = r;
    tileData[o + 1] = g;
    tileData[o + 2] = b;
    tileData[o + 3] = 0; // alpha = emission gain, not coverage
  }
}

function buildRuntime(paint: BiomePaint, plan: SlotPlan): PaintLayerRuntime {
  const { slotKeys } = plan;
  if (slotKeys.length === 0) return EMPTY;

  // The field: one texel per paint cell.
  const fieldData = new Uint8Array(paint.cols * paint.rows * 4);
  fillFieldData(paint, plan, fieldData);
  const field = new THREE.DataTexture(fieldData, paint.cols, paint.rows);
  field.magFilter = THREE.NearestFilter;
  field.minFilter = THREE.NearestFilter;
  field.generateMipmaps = false;
  field.needsUpdate = true;

  // The tile array: each layer flat-filled with its swatch's colour until the
  // real image decodes (builtin sets get neutral grey, their JPEG is bundled
  // and WILL land, and grey avoids a colour flash under the tint ratio).
  const layerBytes = TILE_SIZE * TILE_SIZE * 4;
  const tileData = new Uint8Array(layerBytes * slotKeys.length);
  tileData.fill(140);
  // The tile ALPHA channel is the emission gain (lava glow), NOT coverage: 0
  // everywhere until a glowing set's Emission map decodes. Riding the albedo
  // array keeps the splat material inside the fragment-sampler budget, a
  // dedicated emission array was one sampler too many on 16-unit GPUs.
  for (let i = 3; i < tileData.length; i += 4) tileData[i] = 0;
  slotKeys.forEach((key, slot) => {
    if (key.startsWith('sha:')) fillLayerFlat(tileData, slot, plan.swatchOfSlot[slot].color);
  });
  const tiles = new THREE.DataArrayTexture(tileData, TILE_SIZE, TILE_SIZE, slotKeys.length);
  tiles.colorSpace = THREE.SRGBColorSpace;
  tiles.wrapS = THREE.RepeatWrapping;
  tiles.wrapT = THREE.RepeatWrapping;
  tiles.magFilter = THREE.LinearFilter;
  tiles.minFilter = THREE.LinearMipmapLinearFilter;
  tiles.generateMipmaps = true;
  tiles.anisotropy = 4;
  tiles.needsUpdate = true;

  // The matching tangent-space NormalGL layers: neutral (flat) until each
  // set's map decodes. Linear data, a normal map through sRGB decode bends
  // every slope, and mipped like the albedo so painted relief fades out
  // rather than shimmering.
  const normData = new Uint8Array(layerBytes * slotKeys.length);
  for (let o = 0; o < normData.length; o += 4) {
    normData[o] = 128;
    normData[o + 1] = 128;
    normData[o + 2] = 255;
    normData[o + 3] = 255;
  }
  const aoData = new Uint8Array(layerBytes * slotKeys.length).fill(255);
  const aoMean = new Float32Array(MAX_PAINT_SLOTS).fill(1);
  const aoGain = new Float32Array(MAX_PAINT_SLOTS);
  const aoTiles = new THREE.DataArrayTexture(aoData, TILE_SIZE, TILE_SIZE, slotKeys.length);
  aoTiles.wrapS = THREE.RepeatWrapping;
  aoTiles.wrapT = THREE.RepeatWrapping;
  aoTiles.magFilter = THREE.LinearFilter;
  aoTiles.minFilter = THREE.LinearMipmapLinearFilter;
  aoTiles.generateMipmaps = true;
  aoTiles.anisotropy = 4;
  aoTiles.needsUpdate = true;
  const normTiles = new THREE.DataArrayTexture(normData, TILE_SIZE, TILE_SIZE, slotKeys.length);
  normTiles.wrapS = THREE.RepeatWrapping;
  normTiles.wrapT = THREE.RepeatWrapping;
  normTiles.magFilter = THREE.LinearFilter;
  normTiles.minFilter = THREE.LinearMipmapLinearFilter;
  normTiles.generateMipmaps = true;
  normTiles.anisotropy = 4;
  normTiles.needsUpdate = true;

  const tileSizes = new Float32Array(MAX_PAINT_SLOTS);
  fillTileSizes(plan, paint, tileSizes);
  const tileVar = new Float32Array(MAX_PAINT_SLOTS);
  fillTileVar(plan, paint, tileVar);
  const tileDepth = new Float32Array(MAX_PAINT_SLOTS);
  fillTileDepth(plan, paint, tileDepth);

  // Draw a decoded image (JPEG or ImageBitmap) into its layer, bottom-up rows
  // like the packed splat albedo: DataArrayTexture never flips while UV
  // convention expects image textures' flipY.
  const drawInto = (
    img: CanvasImageSource,
    data: Uint8Array,
    texture: THREE.DataArrayTexture,
    slot: number,
    measure = false,
  ): void => {
    const canvas = document.createElement('canvas');
    canvas.width = TILE_SIZE;
    canvas.height = TILE_SIZE;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    ctx.translate(0, TILE_SIZE);
    ctx.scale(1, -1);
    ctx.drawImage(img, 0, 0, TILE_SIZE, TILE_SIZE);
    const px = ctx.getImageData(0, 0, TILE_SIZE, TILE_SIZE).data;
    data.set(px, slot * layerBytes);
    texture.needsUpdate = true;
    if (measure) measureAo(px, slot, aoMean, aoGain);
  };
  // Per-slot emission gain (the Emission map's brightest channel, 0-255),
  // applied into the colour layer's ALPHA. Kept aside because the colour JPEG
  // and the emission JPEG decode in either order: whichever lands second,
  // applyEmisAlpha re-stamps the same bytes (idempotent).
  const emisGain = new Map<number, Uint8Array>();
  const applyEmisAlpha = (slot: number): void => {
    const gain = emisGain.get(slot);
    const o0 = slot * layerBytes;
    for (let i = 0; i < TILE_SIZE * TILE_SIZE; i++) {
      tileData[o0 + i * 4 + 3] = gain ? gain[i] : 0;
    }
    tiles.needsUpdate = true;
  };
  const drawLayer = (img: CanvasImageSource, slot: number): void => {
    drawInto(img, tileData, tiles, slot);
    // getImageData stamped opaque alpha over the layer; restore the gain.
    applyEmisAlpha(slot);
  };
  // Fire-and-forget: a normal map landing late just pops its relief in; the
  // `on` gate below stays tied to the COLOUR layers so paint is never held
  // hostage by a missing relief map.
  const loadNormLayer = (key: string, slot: number): void => {
    if (key.startsWith('sha:')) return; // imported textures ship no normal map
    const path = terrainTexturePath(key, 'normal');
    if (!path) return;
    const img = new Image();
    img.onload = () => drawInto(img, normData, normTiles, slot);
    img.src = assetUrl(path);
  };
  // Fire-and-forget like the normals: AO landing late just deepens the
  // crevices in. White until then, which shades nothing.
  const loadAoLayer = (key: string, slot: number): void => {
    if (key.startsWith('sha:')) return; // imported textures ship no AO map
    const path = terrainTexturePath(key, 'ao');
    if (!path) return;
    const img = new Image();
    img.onload = () => drawInto(img, aoData, aoTiles, slot, true);
    img.src = assetUrl(path);
  };
  // Fire-and-forget like the normals: a glow landing late just fades in.
  const loadEmisLayer = (key: string, slot: number): void => {
    if (key.startsWith('sha:')) return; // imported textures ship no emission map
    const path = terrainTexturePath(key, 'emission');
    if (!path) return;
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = TILE_SIZE;
      canvas.height = TILE_SIZE;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;
      ctx.translate(0, TILE_SIZE);
      ctx.scale(1, -1);
      ctx.drawImage(img, 0, 0, TILE_SIZE, TILE_SIZE);
      const px = ctx.getImageData(0, 0, TILE_SIZE, TILE_SIZE).data;
      const gain = new Uint8Array(TILE_SIZE * TILE_SIZE);
      for (let i = 0; i < gain.length; i++) {
        gain[i] = Math.max(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]);
      }
      emisGain.set(slot, gain);
      applyEmisAlpha(slot);
    };
    img.src = assetUrl(path);
  };

  const on = { value: 0 };
  let settled = 0;
  // The shader path flips on once every layer SETTLED (decoded or failed):
  // a failed layer already holds its flat swatch colour, so waiting on it
  // forever would hold every other painted texture hostage.
  const settle = (): void => {
    settled++;
    if (settled === slotKeys.length) on.value = 1;
  };
  slotKeys.forEach((key, slot) => {
    loadNormLayer(key, slot);
    loadAoLayer(key, slot);
    loadEmisLayer(key, slot);
    if (key.startsWith('sha:')) {
      void groundImageFor(key.slice('sha:'.length))
        .then((bitmap) => {
          if (bitmap) drawLayer(bitmap, slot);
        })
        .catch(() => {})
        .finally(settle);
      return;
    }
    const path = terrainTexturePath(key, 'color');
    if (!path) {
      settle();
      return;
    }
    const img = new Image();
    img.onload = () => {
      drawLayer(img, slot);
      settle();
    };
    img.onerror = settle;
    img.src = assetUrl(path);
  });

  return {
    field,
    tiles,
    normTiles,
    tileSizes,
    tileVar,
    tileDepth,
    aoTiles,
    aoMean,
    aoGain,
    grid: new THREE.Vector4(paint.originX, paint.originZ, 1 / paint.cell, slotKeys.length),
    dims: new THREE.Vector2(paint.cols, paint.rows),
    edge: (() => {
      const e = paintEdgeParams(paint);
      return new THREE.Vector2(e.warpYd, e.spreadCells);
    })(),
    on,
  };
}

/** The active content's paint-layer runtime, cached per BiomePaint identity. */
export function paintLayerRuntime(): PaintLayerRuntime {
  const paint = getActiveWorldContent().biomePaint;
  if (!paint || !paint.custom || paint.custom.length === 0) return EMPTY;
  if (cache && cache.paint === paint) return cache.runtime;
  const plan = planSlots(paint);
  cache = { paint, runtime: buildRuntime(paint, plan), slotKeys: plan.slotKeys };
  return cache.runtime;
}

/** Editor hook: forget the cached field so the next terrain build re-reads the
 *  active content's paint (repaints mutate BiomePaint in place). */
export function invalidatePaintLayerRuntime(): void {
  cache = null;
}

/**
 * Live update between terrain builds: a paint stroke, a hue/light slider, a
 * tile-size drag. While the slot assignment is unchanged the field bytes and
 * tile sizes rewrite in place (the material holds references, so the change
 * is on screen next frame). Returns:
 *   'updated', done, nothing else to do;
 *   'rebuild', the slot set changed (or the material has no paint path yet):
 *                only a full terrain rebuild can show it;
 *   'off', the map has no texture paint; nothing to refresh.
 */
export function refreshPaintFieldLive(): 'updated' | 'rebuild' | 'off' {
  const paint = getActiveWorldContent().biomePaint;
  const wantsTextures = (paint?.custom ?? []).some((s) => textureSlotSwatch(s) !== null);
  if (!paint || !wantsTextures) return 'off';
  const live = cache;
  if (!live || live.paint !== paint || !live.runtime.field) return 'rebuild';
  const plan = planSlots(paint);
  if (
    plan.slotKeys.length !== live.slotKeys.length ||
    plan.slotKeys.some((k, i) => k !== live.slotKeys[i])
  ) {
    return 'rebuild';
  }
  fillFieldData(paint, plan, live.runtime.field.image.data as Uint8Array);
  live.runtime.field.needsUpdate = true;
  fillTileSizes(plan, paint, live.runtime.tileSizes);
  fillTileVar(plan, paint, live.runtime.tileVar);
  fillTileDepth(plan, paint, live.runtime.tileDepth);
  // The material holds this Vector2 by reference, so a slider drag lands on
  // the live shader the same frame the field bytes do.
  const edge = paintEdgeParams(paint);
  live.runtime.edge.set(edge.warpYd, edge.spreadCells);
  return 'updated';
}

/** Fragment-side sampling, injected by buildSplatMaterial. Expects vWPos and
 *  the uniforms declared in PAINT_LAYER_UNIFORMS_GLSL; leaves wocPaintCol /
 *  wocPaintW in scope.
 *
 *  BILINEAR over the four surrounding cell centres, smoothstepped, so the
 *  boundary is a smooth one-cell gradient instead of the stepped quarter
 *  weights the old four diagonal taps produced ("the texture on the edges is
 *  blocky"). Fully painted interior resolves to weight 1.0 EXACTLY: the old
 *  0.94 cap left 6% of the base splat (leaf litter and all) bleeding through
 *  ground the maker painted solid. The CPU tint bridge keeps its coarser
 *  vertex feather; the fragment weight above overrides it wherever paint is
 *  solid, so the two only co-exist inside the one-cell edge band. */
/**
 * The paint-boundary warp, shared verbatim by the ground splat and the carve
 * interior material (cut_cavity_mesh.ts) so a boundary running across a cave
 * mouth meets itself. Expects `uniform vec2 uPaintEdge` in scope: x = warp
 * amplitude in YARDS, y = blend kernel half-width in cells.
 *
 * Why a warp at all: the paint grid is 0.25-0.5yd, so a boundary that follows
 * it is a straight line a hand's width wide -- a cut-out, not a place where
 * sand meets grass. Displacing the FIELD lookup (never the tile UV, which
 * would smear the texture itself) by a couple of octaves of world-space noise
 * turns that line into interlocking fingers at a scale the grid could never
 * express, for no extra texture tap. Same analytic-sine family as wocTileMix,
 * and for the same reason: no bandwidth, and no repeat of its own at any
 * scale a map covers.
 */
/** The sun's XZ heading as a unit step, inlined into the micro-shadow tap.
 *  The tile uv for the up-facing plane maps +u straight onto +world-x and +v
 *  onto +world-z, so the azimuth needs no basis change. */
const SUN_UV = (() => {
  const h = Math.hypot(SUN_DIR.x, SUN_DIR.z) || 1;
  return { x: (SUN_DIR.x / h).toFixed(5), z: (SUN_DIR.z / h).toFixed(5) };
})();
const SUN_UV_X = SUN_UV.x;
const SUN_UV_Z = SUN_UV.z;

export const PAINT_EDGE_WARP_GLSL = `
        vec2 wocEdgeWarp(vec2 w) {
          // Cross-driven (the x offset comes from w.y and back) so the
          // boundary MEANDERS rather than sliding bodily sideways.
          vec2 a = vec2(
            sin(w.y * 0.7351 + 1.3) + 0.55 * sin(w.y * 1.9173 - 2.7),
            sin(w.x * 0.6917 - 0.4) + 0.55 * sin(w.x * 1.8329 + 1.9));
          vec2 b = vec2(sin(w.y * 3.2411 + 0.7), sin(w.x * 3.4177 - 1.1));
          // Normalized so |result| <= 1 and the uniform reads in true yards.
          return (a * 0.62 + b * 0.22) * 0.847;
        }`;

export const PAINT_LAYER_UNIFORMS_GLSL = `
        uniform sampler2D uPaintField;
        uniform sampler2DArray uPaintTiles;
        uniform sampler2DArray uPaintNormTiles;
        uniform vec4 uPaintGrid;   // originX, originZ, 1/cell, slotCount
        uniform vec2 uPaintDims;   // cols, rows
        uniform float uPaintTileSizes[${MAX_PAINT_SLOTS}];
        uniform float uPaintTileVar[${MAX_PAINT_SLOTS}];
        uniform float uPaintTileDepth[${MAX_PAINT_SLOTS}];
        uniform sampler2DArray uPaintAoTiles;

        // ANTI-TILING. One tap at worldXZ/period is a perfect grid, and on
        // open painted ground the eye finds it immediately. Above zero this
        // takes a SECOND tap through a frame rotated ~57 degrees and offset
        // by a third of a period, then blends the two by a smooth
        // low-frequency field - so the two repeats never coincide and the
        // seam between them wanders. Gated per swatch, so a maker pays the
        // extra tap only where they asked for it.
        //
        // The blend field is analytic rather than a texture lookup: three
        // sines on mutually irrational frequencies, which has no repeat of
        // its own at any scale a map covers and costs no bandwidth.
        float wocTileMix(vec2 w) {
          float a = sin(w.x * 0.0131 + 1.7) * sin(w.y * 0.0117 - 0.4);
          float b = sin((w.x + w.y) * 0.00721 + 2.3);
          return clamp(0.5 + 0.42 * a + 0.30 * b, 0.0, 1.0);
        }
        vec4 wocTileTap(vec2 uv, float period, float slot, float varAmt, vec2 dx, vec2 dy) {
          vec4 base = textureGrad(uPaintTiles, vec3(uv / period, slot), dx / period, dy / period);
          if (varAmt <= 0.001) return base;
          // 57 degrees: far from any multiple of 90, so the rotated copy
          // shares no axis with the original and the grids cannot re-align.
          const float C = 0.5446, S = 0.8387;
          vec2 ruv = vec2(uv.x * C - uv.y * S, uv.x * S + uv.y * C) + period * 0.331;
          vec2 rdx = vec2(dx.x * C - dx.y * S, dx.x * S + dx.y * C);
          vec2 rdy = vec2(dy.x * C - dy.y * S, dy.x * S + dy.y * C);
          vec4 alt = textureGrad(uPaintTiles, vec3(ruv / period, slot), rdx / period, rdy / period);
          return mix(base, alt, wocTileMix(uv) * clamp(varAmt, 0.0, 1.0));
        }

        uniform vec2 uPaintEdge;
        ${PAINT_EDGE_WARP_GLSL}
        uniform float uPaintAoMean[${MAX_PAINT_SLOTS}];
        uniform float uPaintAoGain[${MAX_PAINT_SLOTS}];

        // SURFACE RELIEF tuning. All amplitudes are relative to the swatch's
        // own tile period, so a texture tiled at 6yd and one at 24yd get the
        // same relief per stone rather than per yard. The height they act on
        // is zero-mean and unit-VARIANCE (see measureAo), so "1.0" below means
        // one standard deviation of that texture's own AO.
        //
        // Sized against the shipped library: 66 AO sheets, mean 0.93, sd from
        // 0.008 (Snow003) to 0.130 (PavingStones046), median 0.041.
        // The AO taps sample 2 mip levels COARSER than the tile taps. The
        // sheets are 8x8-DCT jpegs and the normalisation below multiplies
        // whatever it is handed: at native res the blocking sits exactly in
        // the 8-texel band, while real relief (mortar lines, cobble crowns)
        // lives at 50-200 texels. Dropping two mips averages the noise band
        // away and barely touches the signal, far better than capping the
        // gain hard enough to kill the effect. measureAo's cap assumes this
        // attenuation (AO_BLOCK_ATTEN).
        const float WOC_PAINT_AO_LOD_BIAS = 4.0;
        const float WOC_PAINT_CAVITY = 0.16;      // +-16% per sd, was +-3%
        const float WOC_PAINT_SUN_STEP = 0.02;    // x period: clod-scale step
        const float WOC_PAINT_SUN_K = 0.9;        // sd difference -> full shadow
        const float WOC_PAINT_SUN_AMT = 0.45;     // max darkening in shadow
        const float WOC_PAINT_PARALLAX_AMP = 0.010;   // x period, per sd
        const float WOC_PAINT_PARALLAX_CLAMP = 0.020; // x period, hard cap
        const float WOC_PAINT_RELIEF_NEAR = 18.0; // directional passes fade
        const float WOC_PAINT_RELIEF_FAR = 40.0;  //   out across this band
        const float WOC_PAINT_CAV_NEAR = 80.0;    // the cavity tap reaches
        const float WOC_PAINT_CAV_FAR = 120.0;    //   further: view-independent
        uniform float uPaintOn;`;

/**
 * Fragment-side sampling. `reliefLevel` is the SAME ladder the splat ground
 * uses (render/terrain.ts terrainReliefLevel): 0 none, 1 cavity, 2+ the
 * directional passes. Painted relief used to ignore it entirely, so a player
 * on a low tier, or anyone bisecting with `?trelief=off`, still paid the
 * paint block's AO taps and still saw its shading. Tiering it here keeps the
 * painted ground honest with the ground beside it, and makes the dev flag
 * cover this code too (SPACEY, 2026-09-22: the flag was not testing it).
 */
export function paintLayerSampleGlsl(reliefLevel: number): string {
  return `
        vec3 wocPaintCol = vec3(0.0);
        vec3 wocPaintEmis = vec3(0.0);
        vec3 wocEmisAcc = vec3(0.0);
        float wocPaintW = 0.0;
        // The per-chunk presence bit (flat varying: constant across the draw,
        // so this branch never diverges inside a triangle) stands the whole
        // block down on ground with no painted texture within reach. The
        // shipped overworld and every unpainted chunk of a painted map pay
        // nothing here.
        if (uPaintOn > 0.5 && vTerrainPaintPresence > 0.5) {
          // Bilinear over the 2x2 surrounding cell centres. The field's R
          // channel is a slot INDEX so the texture itself must stay nearest
          // filtered; the WEIGHT interpolates instead: each painted cell
          // contributes its bilinear factor, unpainted cells contribute zero.
          // The position every FIELD lookup below uses: the true world point
          // pushed around by the edge warp. Tile UVs keep the true position.
          vec2 wocPW = vWPos.xz + wocEdgeWarp(vWPos.xz) * uPaintEdge.x;
          // Kernel half-width in cells. At 1.0 this is byte-for-byte the old
          // adjacent-centre bilinear; above it the four taps step apart, which
          // is what resolves a soft brush's DITHERED rim (editor paintStep
          // stores coverage as a dither -- one cell holds one swatch, it
          // cannot hold "40% grass") into the coverage ramp it stands for.
          // A one-cell kernel renders that dither as salt-and-pepper speckle,
          // which is why Brush hardness looked like it did almost nothing.
          float wocSp = max(uPaintEdge.y, 1.0);
          vec2 wocQ = (wocPW - uPaintGrid.xy) * uPaintGrid.z;
          vec2 wocCs = (wocQ - 0.5 * wocSp) / wocSp;
          vec2 wocI = floor(wocCs);
          vec2 wocFr = smoothstep(0.0, 1.0, fract(wocCs));
          // The tile taps below sit inside branches, which is only safe with
          // EXPLICIT gradients: implicit ones are undefined in divergent flow
          // and etched a one-pixel grid along every paint edge in the first
          // cut of this shader. Take the world-space derivatives once, here,
          // in uniform flow.
          // Slope-aware plane for the TILE taps. The FIELD lookup stays
          // top-down (uPaintGrid is a top-down footprint: the maker paints a
          // plan, and a cliff belongs to the cell above it), but sampling the
          // tile itself through vWPos.xz stretches it by 1/cos across a
          // slope - the vertical streaking, and the only reason paint had to
          // stand down on steep ground at all. Picking the dominant plane
          // costs ZERO extra taps: it re-aims the one tap already being
          // taken. (The 2026-09-09 attempt blended a SECOND sample per layer
          // instead, which is what cost the frames and got reverted.)
          // Geometric normal, same reason as terrain.ts: a skirt/rim curtain
          // carries the surface normal and would otherwise keep the top-down
          // tile projection on a sheer wall.
          // Same plane the base layers use (see terrain.ts). The paint FIELD
          // lookup stays top-down - uPaintGrid is a plan, and a cliff belongs
          // to the cell above it - but the TILE must follow the surface.
          vec3 wocPShade = normalize(vWNorm);
          vec3 wocPRaw = cross(dFdx(vWPos.xyz), dFdy(vWPos.xyz));
          vec3 wocPGeo = length(wocPRaw) > 1e-12 ? normalize(wocPRaw) : wocPShade;
          if (dot(wocPGeo, wocPShade) < 0.0) wocPGeo = -wocPGeo;
          vec3 wocPN = normalize(mix(wocPShade, wocPGeo,
            smoothstep(0.35, 0.65, abs(wocPShade.y) - abs(wocPGeo.y))));
          vec3 wocAN = abs(wocPN);
          vec2 wocPUv = wocAN.y >= max(wocAN.x, wocAN.z)
            ? vec2(vWPos.x * sign(wocPN.y), vWPos.z)
            : (wocAN.x >= wocAN.z
                ? vec2(vWPos.z * sign(wocPN.x), vWPos.y)
                : vec2(vWPos.x * -sign(wocPN.z), vWPos.y));
          // Derivatives of the UV ACTUALLY sampled, once, in uniform flow.
          vec2 wocDx = dFdx(wocPUv);
          vec2 wocDy = dFdy(wocPUv);
          float wocPaintN = 0.0;
          // Fast path: the cell under the fragment is INTERIOR (bit 7 of the
          // field's R byte: all eight neighbours the same swatch), or the
          // fragment is far enough that the tile's mips have already blurred
          // the one-cell feather away. One field tap, one tile tap, same
          // colour as the full blend below.
          vec2 wocC0uv = wocQ / uPaintDims;
          vec4 wocF0 = texture2D(uPaintField, wocC0uv);
          float wocRaw0 = floor(wocF0.r * 255.0 + 0.5);
          bool wocIn0 =
            wocC0uv.x >= 0.0 && wocC0uv.x < 1.0 && wocC0uv.y >= 0.0 && wocC0uv.y < 1.0;
          bool wocPainted0 = wocIn0 && wocRaw0 < 250.0;
          bool wocInterior0 = wocPainted0 && wocRaw0 >= 128.0;
          bool wocFar = length(vViewPosition) > 160.0;
          // ---- SURFACE RELIEF ------------------------------------------
          // Painted ground used to get ONE flat AO multiply while the splat
          // ground got parallax + cavity + micro sun-shadow off its packed
          // height field, which is why paving read as a printed decal beside
          // real rock ("the surface detail really adds very little depth",
          // SPACEY, 2026-09-22). The three passes below are the painted
          // equivalent, in the order they have to happen: the height tap
          // first, then the parallax that MOVES wocPUv, then the tile taps.
          //
          // The old curve was mix(1.0, 0.42 + 0.78 * ao, depth). Against a
          // library averaging ao = 0.93 that is a 14% brightening carrying a
          // +-3% ripple -- the reason the slider looked inert. Normalising by
          // each sheet's measured mean and sd makes it DC-neutral and gives
          // every texture the same swing.
          // (wocSlot0 is scoped to the fast-path branch below; wocRaw0 is not,
          // so the centre slot is derived here where every path can see it.)
          float wocSlotC = min(wocRaw0 - 128.0 * step(128.0, wocRaw0), ${(MAX_PAINT_SLOTS - 1).toFixed(1)});
          float wocDepth = uPaintTileDepth[int(wocSlotC)];
          float wocAoGain = uPaintAoGain[int(wocSlotC)];
          float wocViewD = length(vViewPosition);
          float wocCavFade =
            1.0 - smoothstep(WOC_PAINT_CAV_NEAR, WOC_PAINT_CAV_FAR, wocViewD);
          float wocShade = 1.0;
          // Gain 0 means the sheet is flat enough that its "relief" is JPEG
          // noise, or it never loaded (white) -- either way, no tap.
          if (${reliefLevel >= 1 ? 'true' : 'false'} &&
              wocPainted0 && wocDepth > 0.001 && wocAoGain > 0.0 && wocCavFade > 0.01) {
            float wocPeriodC = uPaintTileSizes[int(wocSlotC)];
            float wocAoM = uPaintAoMean[int(wocSlotC)];
            // Coarser gradients => coarser mip => the jpeg block band is gone
            // before the gain ever sees it.
            vec2 wocAoDx = wocDx * (WOC_PAINT_AO_LOD_BIAS / wocPeriodC);
            vec2 wocAoDy = wocDy * (WOC_PAINT_AO_LOD_BIAS / wocPeriodC);
            float wocH = (textureGrad(uPaintAoTiles, vec3(wocPUv / wocPeriodC, wocSlotC),
              wocAoDx, wocAoDy).r - wocAoM) * wocAoGain;
            wocH = clamp(wocH, -2.5, 2.5);
            // CAVITY: view-independent, so the relief still reads from the
            // high pitched-down chase camera, where a parallax offset does
            // nothing at all.
            wocShade = 1.0 + wocH * wocDepth * WOC_PAINT_CAVITY * wocCavFade;
            // The two DIRECTIONAL passes are near-field only: past the fade
            // the AO mips have flattened, and offsetting UVs by a blurry
            // height signal reads as smear rather than relief.
            float wocRlf =
              1.0 - smoothstep(WOC_PAINT_RELIEF_NEAR, WOC_PAINT_RELIEF_FAR, wocViewD);
            // pDir below is a world-XZ tangent frame, meaningless once the
            // triplanar uv has flipped to a wall plane -- same dominance gate
            // the splat ground's parallax uses.
            if (${reliefLevel >= 2 ? 'true' : 'false'} &&
                wocRlf > 0.02 && wocAN.y >= max(wocAN.x, wocAN.z)) {
              // MICRO SUN-SHADOW. One clod-scale step toward the sun: if the
              // surface stands higher there, this point is in its shadow.
              // THIS is the pass that makes a crevice read as a crevice -- a
              // flat AO multiply has no direction, so it only ever reads as
              // dirt in the grooves.
              vec2 wocSunStep =
                vec2(${SUN_UV_X}, ${SUN_UV_Z}) * wocPeriodC * WOC_PAINT_SUN_STEP;
              float wocHS = (textureGrad(uPaintAoTiles,
                vec3((wocPUv + wocSunStep) / wocPeriodC, wocSlotC),
                wocAoDx, wocAoDy).r - wocAoM) * wocAoGain;
              wocShade *= 1.0 - clamp((wocHS - wocH) * WOC_PAINT_SUN_K, 0.0, 1.0)
                * wocDepth * wocRlf * WOC_PAINT_SUN_AMT;
              // OFFSET PARALLAX. Slide the tile uv along the view ray by the
              // height, so stones occlude one another as the camera moves --
              // the only pass that gives real low and high points rather than
              // a painted-on impression of them. Planar-XZ uvs put the
              // tangent frame on world x/z, so the ray projects with no TBN;
              // the divisor floor caps a grazing ray instead of letting it
              // stretch the uv into a smear.
              vec3 wocPRay = cameraPosition - vWPos.xyz;
              float wocPDist = max(length(wocPRay), 1e-3);
              float wocPNdv = dot(wocPN, wocPRay) / wocPDist;
              float wocPFade = wocRlf * smoothstep(0.15, 0.38, wocPNdv) * wocDepth;
              if (wocPFade > 0.015) {
                vec2 wocPDir = wocPRay.xz / max(wocPRay.y, wocPDist * 0.45);
                float wocPLim = wocPeriodC * WOC_PAINT_PARALLAX_CLAMP;
                float wocPAmp = wocPeriodC * WOC_PAINT_PARALLAX_AMP * wocPFade;
                vec2 wocOff = wocPDir * wocH * wocPAmp;
                wocOff /= max(1.0, length(wocOff) / wocPLim);
                // Second iteration, re-read where the first offset landed:
                // without it steep stone edges overshoot and swim at grazing
                // angles (the splat ground's parallax does the same).
                float wocH2 = (textureGrad(uPaintAoTiles,
                  vec3((wocPUv + wocOff) / wocPeriodC, wocSlotC),
                  wocAoDx, wocAoDy).r - wocAoM) * wocAoGain;
                wocOff = wocPDir * clamp(wocH2, -2.5, 2.5) * wocPAmp;
                wocOff /= max(1.0, length(wocOff) / wocPLim);
                wocPUv += wocOff;
              }
            }
          }
          if (wocInterior0 || (wocFar && wocPainted0)) {
            float wocSlot0 = wocRaw0 - 128.0 * step(128.0, wocRaw0);
            float wocPeriod0 = uPaintTileSizes[int(min(wocSlot0, ${(MAX_PAINT_SLOTS - 1).toFixed(1)}))];
            vec4 wocTexel0 = wocTileTap(wocPUv, wocPeriod0, wocSlot0,
              uPaintTileVar[int(min(wocSlot0, ${(MAX_PAINT_SLOTS - 1).toFixed(1)}))], wocDx, wocDy);
            vec3 wocTint0 = wocF0.gba * 2.0;
            wocPaintCol = wocTexel0.rgb * wocTint0;
            wocEmisAcc = wocTexel0.rgb * (wocTexel0.a * 1.7) * wocTint0;
            wocPaintN = 1.0;
          } else if (!(wocFar && !wocPainted0)) {
          float wocSlots[4];
          float wocWs[4];
          vec3 wocTints[4];
          for (int wpi = 0; wpi < 4; wpi++) {
            vec2 wocIJ = floor(
              (wocI + vec2(wpi < 2 ? 0.0 : 1.0, (wpi == 0 || wpi == 2) ? 0.0 : 1.0)) * wocSp +
                0.5 * wocSp);
            float wocBW = (wpi < 2 ? 1.0 - wocFr.x : wocFr.x) *
              ((wpi == 0 || wpi == 2) ? 1.0 - wocFr.y : wocFr.y);
            vec2 wocCuv = (wocIJ + 0.5) / uPaintDims;
            float wocInRange =
              step(0.0, wocCuv.x) * step(wocCuv.x, 0.999999) *
              step(0.0, wocCuv.y) * step(wocCuv.y, 0.999999);
            vec4 wocF = texture2D(uPaintField, wocCuv);
            float wocRaw = floor(wocF.r * 255.0 + 0.5);
            float wocSlot = wocRaw - 128.0 * step(128.0, wocRaw);
            wocBW *= wocInRange * step(wocRaw, 249.0);
            wocSlots[wpi] = min(wocSlot, ${(MAX_PAINT_SLOTS - 1).toFixed(1)});
            wocWs[wpi] = wocBW;
            wocTints[wpi] = wocF.gba * 2.0;
            wocPaintN += wocBW;
          }
          if (wocPaintN > 0.001) {
            vec3 wocPaintAcc = vec3(0.0);
            // One tile tap per DISTINCT texture among the weighted cells: a
            // cell with zero weight costs nothing, and the common interior
            // case (all four cells the same swatch) is a single tap carrying
            // the summed weight, exactly the old four-tap sum.
            for (int wpi = 0; wpi < 4; wpi++) {
              float wocW = wocWs[wpi];
              if (wocW <= 0.0) continue;
              vec3 wocT = wocTints[wpi] * wocW;
              for (int wpj = wpi + 1; wpj < 4; wpj++) {
                if (wocWs[wpj] > 0.0 && wocSlots[wpj] == wocSlots[wpi]) {
                  wocT += wocTints[wpj] * wocWs[wpj];
                  wocWs[wpj] = 0.0;
                }
              }
              float wocPeriod = uPaintTileSizes[int(wocSlots[wpi])];
              vec4 wocTexel = wocTileTap(wocPUv, wocPeriod, wocSlots[wpi],
                uPaintTileVar[int(wocSlots[wpi])], wocDx, wocDy);
              wocPaintAcc += wocTexel.rgb * wocT;
              wocEmisAcc += wocTexel.rgb * (wocTexel.a * 1.7) * wocT;
            }
            wocPaintCol = wocPaintAcc / wocPaintN;
          }
          }
          // The relief shading resolved above (cavity x micro sun-shadow),
          // applied once the albedo has been composed.
          if (wocPaintN > 0.001) wocPaintCol *= wocShade;
          if (wocPaintN > 0.001) {
            // Remap so every PAINTED cell is solid edge to edge (a painted
            // cell bordering unpainted ground bottoms out at coverage 0.5 at
            // its own border) and the smooth fade lives entirely in the
            // UNPAINTED neighbour band. Without this, half of every border
            // cell still blended toward whatever sat underneath - on a bank
            // that read as "cliff on the perimeter of my paint".
            wocPaintW = smoothstep(0.0, 0.5, wocPaintN);
            // NO slope stand-down. Paint covers terrain at EVERY angle,
            // vertical faces included (SPACEY, 2026-09-21: "make it so all
            // terrain on the map can be painted over what ever the current
            // texture is"). Previously it faded out past ~55 degrees so a
            // maker simply could not paint a cliff.
            //
            // The stand-down existed to HIDE a real defect, not to cause one:
            // the tile projects top-down (vWPos.xz), so on a steep face it
            // squeezes by 1/cos and reads as vertical streaks. That defect is
            // still here - painting a cliff will look stretched until the
            // projection is fixed properly, which is deliberately the NEXT
            // piece of work. Paintability first; the stretch after.
            // The glow rides the paint weight: molten veins light up exactly
            // where their texture is on the ground (terrain.ts adds this into
            // totalEmissiveRadiance).
            wocPaintEmis = (wocEmisAcc / wocPaintN) * wocPaintW;
          }
        }`;
}

/**
 * The painted texture's OWN relief, injected in the normal_fragment_maps
 * section (after `wocDetailN` is in scope). ONE centre tap of the field +
 * ONE of the normal array, gated by the SAME near-distance fade the splat's
 * own detail normals use, relief mips toward flat past that range anyway,
 * so paying 8 array taps per fragment at every distance (the first cut of
 * this feature) bought nothing visible and cost real frame time on a fully
 * auto-retextured map. Feathered boundaries stay an albedo concern; a
 * hard-edged normal at a cell border is invisible under the albedo blend.
 */
export const PAINT_NORMAL_GLSL = `
        // Uniform flow: GLSL leaves dFdx/dFdy undefined inside the per-pixel
        // branches below (the innermost keys off a texture read).
        vec3 wocPnShade = normalize(vWNorm);
        vec3 wocPnRaw3 = cross(dFdx(vWPos.xyz), dFdy(vWPos.xyz));
        vec3 wocPnGeo = length(wocPnRaw3) > 1e-12 ? normalize(wocPnRaw3) : wocPnShade;
        if (dot(wocPnGeo, wocPnShade) < 0.0) wocPnGeo = -wocPnGeo;
        vec3 wocPnNrm = normalize(mix(wocPnShade, wocPnGeo,
          smoothstep(0.35, 0.65, abs(wocPnShade.y) - abs(wocPnGeo.y))));
        vec3 wocPnAN = abs(wocPnNrm);
        vec2 wocPnUvT = wocPnAN.y >= max(wocPnAN.x, wocPnAN.z)
          ? vec2(vWPos.x * sign(wocPnNrm.y), vWPos.z)
          : (wocPnAN.x >= wocPnAN.z
              ? vec2(vWPos.z * sign(wocPnNrm.x), vWPos.y)
              : vec2(vWPos.x * -sign(wocPnNrm.z), vWPos.y));
        // Derivatives of the UV actually sampled, taken HERE, in uniform flow
        // -- the same rule the albedo block states and for the same reason.
        // The tap below sits three per-pixel branches deep (the innermost
        // keys off a texture read), where GLSL leaves dFdx/dFdy UNDEFINED, and
        // uPaintNormTiles is mipmapped with anisotropy: an undefined
        // derivative picks a garbage LOD for the whole 2x2 quad, so scattered
        // quads sampled a far blurrier mip and their flattened normal read as
        // pale screen-aligned squares over painted ground (SPACEY, 2026-09-22:
        // "little slightly light square pixels ... only on some parts of the
        // map"). They tracked the paint, not the geometry, and only inside
        // wocDetailN's near band, which is why they needed looking for.
        //
        // The period has to divide the derivative as well as the UV: it is a
        // PER-PIXEL value (a different swatch is a different tile size), so a
        // gradient taken after the divide would be discontinuous at every
        // slot boundary even in uniform flow.
        vec2 wocPnDx = dFdx(wocPnUvT);
        vec2 wocPnDy = dFdy(wocPnUvT);
        if (wocPaintW > 0.001 && wocDetailN > 0.0) {
          // Same warp as the albedo block, or the relief at a boundary comes
          // from the neighbouring swatch's normal map.
          vec2 wocPnCell =
            (vWPos.xz + wocEdgeWarp(vWPos.xz) * uPaintEdge.x - uPaintGrid.xy) * uPaintGrid.z;
          vec2 wocPnCuv = wocPnCell / uPaintDims;
          if (wocPnCuv.x >= 0.0 && wocPnCuv.x < 1.0 && wocPnCuv.y >= 0.0 && wocPnCuv.y < 1.0) {
            vec4 wocPnF = texture2D(uPaintField, wocPnCuv);
            float wocPnRaw = floor(wocPnF.r * 255.0 + 0.5);
            float wocPnSlot = wocPnRaw - 128.0 * step(128.0, wocPnRaw);
            if (wocPnRaw < 250.0) {
              float wocPnPeriod = uPaintTileSizes[int(wocPnSlot)];
              vec2 wocPnN =
                textureGrad(uPaintNormTiles, vec3(wocPnUvT / wocPnPeriod, wocPnSlot),
                  wocPnDx / wocPnPeriod, wocPnDy / wocPnPeriod).xy * 2.0 - 1.0;
              normal = normalize(
                normal + tbn * vec3(wocPnN * (wocPaintW * wocDetailN * 1.35), 0.0));
            }
          }
        }`;
