// The REAL painted ground textures, on the v0.35 splat pipeline.
//
// terrain_paint_tint.ts brought a map's paint layer back as vertex TINTS (the
// swatch colour over the nearest builtin splat layer) — cobbles read as dark
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
//     the map's swatches reference — the shipped JPEGs for `builtin:` shas,
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
import type { BiomePaint, CustomPaintSwatch } from '../sim/types';
import { groundImageFor } from './assets/ground_textures';
import { assetUrl } from './assets/media';
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
  /** World-yards tiling period per slot. */
  tileSizes: Float32Array;
  /** originX, originZ, 1/cell, slotCount. */
  grid: THREE.Vector4;
  /** cols, rows. */
  dims: THREE.Vector2;
  /** Shared uniform the async tile loads flip to 1 once every layer settled. */
  on: { value: number };
}

const EMPTY: PaintLayerRuntime = {
  field: null,
  tiles: null,
  normTiles: null,
  tileSizes: new Float32Array(MAX_PAINT_SLOTS),
  grid: new THREE.Vector4(0, 0, 0, 0),
  dims: new THREE.Vector2(1, 1),
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

function byteRatio(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v * 127.5)));
}

/** Per-swatch tint ratio: the swatch colour against the set's canonical
 *  average, times the light slider — identity (1,1,1) for an untouched
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
  // Second pass: the interior bit. Same swatch ID (not just the same slot)
  // on all eight neighbours, so the fast path's tint is the blend's tint too.
  for (let r = 1; r < rows - 1; r++) {
    const row = r * cols;
    for (let c = 1; c < cols - 1; c++) {
      const i = row + c;
      const o = i * 4;
      if (out[o] === 255) continue;
      const id = ids[i];
      if (
        ids[i - 1] === id &&
        ids[i + 1] === id &&
        ids[i - cols] === id &&
        ids[i + cols] === id &&
        ids[i - cols - 1] === id &&
        ids[i - cols + 1] === id &&
        ids[i + cols - 1] === id &&
        ids[i + cols + 1] === id
      ) {
        out[o] |= PAINT_FIELD_INTERIOR_BIT;
      }
    }
  }
}

function fillTileSizes(plan: SlotPlan, paint: BiomePaint, out: Float32Array): void {
  out.fill(6);
  for (const s of paint.custom ?? []) {
    const slot = plan.slotOfSwatchId.get(s.id);
    if (slot !== undefined && s.tileSize) out[slot] = s.tileSize;
  }
}

/** Flat-fill one tile layer with a swatch's colour: what an imported texture
 *  shows until its bytes decode, and forever when they are not in this
 *  browser — its own colour, never a foreign texture. */
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
  // real image decodes (builtin sets get neutral grey — their JPEG is bundled
  // and WILL land, and grey avoids a colour flash under the tint ratio).
  const layerBytes = TILE_SIZE * TILE_SIZE * 4;
  const tileData = new Uint8Array(layerBytes * slotKeys.length);
  tileData.fill(140);
  // The tile ALPHA channel is the emission gain (lava glow), NOT coverage: 0
  // everywhere until a glowing set's Emission map decodes. Riding the albedo
  // array keeps the splat material inside the fragment-sampler budget — a
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
  // set's map decodes. Linear data — a normal map through sRGB decode bends
  // every slope — and mipped like the albedo so painted relief fades out
  // rather than shimmering.
  const normData = new Uint8Array(layerBytes * slotKeys.length);
  for (let o = 0; o < normData.length; o += 4) {
    normData[o] = 128;
    normData[o + 1] = 128;
    normData[o + 2] = 255;
    normData[o + 3] = 255;
  }
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

  // Draw a decoded image (JPEG or ImageBitmap) into its layer, bottom-up rows
  // like the packed splat albedo: DataArrayTexture never flips while UV
  // convention expects image textures' flipY.
  const drawInto = (
    img: CanvasImageSource,
    data: Uint8Array,
    texture: THREE.DataArrayTexture,
    slot: number,
  ): void => {
    const canvas = document.createElement('canvas');
    canvas.width = TILE_SIZE;
    canvas.height = TILE_SIZE;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    ctx.translate(0, TILE_SIZE);
    ctx.scale(1, -1);
    ctx.drawImage(img, 0, 0, TILE_SIZE, TILE_SIZE);
    data.set(ctx.getImageData(0, 0, TILE_SIZE, TILE_SIZE).data, slot * layerBytes);
    texture.needsUpdate = true;
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
    grid: new THREE.Vector4(paint.originX, paint.originZ, 1 / paint.cell, slotKeys.length),
    dims: new THREE.Vector2(paint.cols, paint.rows),
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
 *   'updated'  — done, nothing else to do;
 *   'rebuild'  — the slot set changed (or the material has no paint path yet):
 *                only a full terrain rebuild can show it;
 *   'off'      — the map has no texture paint; nothing to refresh.
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
export const PAINT_LAYER_UNIFORMS_GLSL = `
        uniform sampler2D uPaintField;
        uniform sampler2DArray uPaintTiles;
        uniform sampler2DArray uPaintNormTiles;
        uniform vec4 uPaintGrid;   // originX, originZ, 1/cell, slotCount
        uniform vec2 uPaintDims;   // cols, rows
        uniform float uPaintTileSizes[${MAX_PAINT_SLOTS}];
        uniform float uPaintOn;`;

export const PAINT_LAYER_SAMPLE_GLSL = `
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
          vec2 wocC = (vWPos.xz - uPaintGrid.xy) * uPaintGrid.z - 0.5;
          vec2 wocI = floor(wocC);
          vec2 wocFr = smoothstep(0.0, 1.0, fract(wocC));
          // The tile taps below sit inside branches, which is only safe with
          // EXPLICIT gradients: implicit ones are undefined in divergent flow
          // and etched a one-pixel grid along every paint edge in the first
          // cut of this shader. Take the world-space derivatives once, here,
          // in uniform flow.
          vec2 wocDx = dFdx(vWPos.xz);
          vec2 wocDy = dFdy(vWPos.xz);
          float wocPaintN = 0.0;
          // Fast path: the cell under the fragment is INTERIOR (bit 7 of the
          // field's R byte: all eight neighbours the same swatch), or the
          // fragment is far enough that the tile's mips have already blurred
          // the one-cell feather away. One field tap, one tile tap, same
          // colour as the full blend below.
          vec2 wocC0uv = (vWPos.xz - uPaintGrid.xy) * uPaintGrid.z / uPaintDims;
          vec4 wocF0 = texture2D(uPaintField, wocC0uv);
          float wocRaw0 = floor(wocF0.r * 255.0 + 0.5);
          bool wocIn0 =
            wocC0uv.x >= 0.0 && wocC0uv.x < 1.0 && wocC0uv.y >= 0.0 && wocC0uv.y < 1.0;
          bool wocPainted0 = wocIn0 && wocRaw0 < 250.0;
          bool wocInterior0 = wocPainted0 && wocRaw0 >= 128.0;
          bool wocFar = length(vViewPosition) > 160.0;
          if (wocInterior0 || (wocFar && wocPainted0)) {
            float wocSlot0 = wocRaw0 - 128.0 * step(128.0, wocRaw0);
            float wocPeriod0 = uPaintTileSizes[int(min(wocSlot0, ${(MAX_PAINT_SLOTS - 1).toFixed(1)}))];
            vec4 wocTexel0 = textureGrad(
              uPaintTiles, vec3(vWPos.xz / wocPeriod0, wocSlot0),
              wocDx / wocPeriod0, wocDy / wocPeriod0);
            vec3 wocTint0 = wocF0.gba * 2.0;
            wocPaintCol = wocTexel0.rgb * wocTint0;
            wocEmisAcc = wocTexel0.rgb * (wocTexel0.a * 1.7) * wocTint0;
            wocPaintN = 1.0;
          } else if (!(wocFar && !wocPainted0)) {
          float wocSlots[4];
          float wocWs[4];
          vec3 wocTints[4];
          for (int wpi = 0; wpi < 4; wpi++) {
            vec2 wocIJ = wocI + vec2(wpi < 2 ? 0.0 : 1.0, (wpi == 0 || wpi == 2) ? 0.0 : 1.0);
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
              vec4 wocTexel = textureGrad(
                uPaintTiles, vec3(vWPos.xz / wocPeriod, wocSlots[wpi]),
                wocDx / wocPeriod, wocDy / wocPeriod);
              wocPaintAcc += wocTexel.rgb * wocT;
              wocEmisAcc += wocTexel.rgb * (wocTexel.a * 1.7) * wocT;
            }
            wocPaintCol = wocPaintAcc / wocPaintN;
          }
          }
          if (wocPaintN > 0.001) {
            // Remap so every PAINTED cell is solid edge to edge (a painted
            // cell bordering unpainted ground bottoms out at coverage 0.5 at
            // its own border) and the smooth fade lives entirely in the
            // UNPAINTED neighbour band. Without this, half of every border
            // cell still blended toward whatever sat underneath - on a bank
            // that read as "cliff on the perimeter of my paint".
            wocPaintW = smoothstep(0.0, 0.5, wocPaintN);
            // Slope stand-down: the paint projects top-down (vWPos.xz), so on
            // a steep face the texture degenerates into vertical streaks -
            // worst on the rim wall of a boolean cut, which is exactly
            // vertical. Fade the paint out past ~55 degrees and let the base
            // splat (rock on rim bands and cliffs) take over.
            wocPaintW *= smoothstep(0.35, 0.60, normalize(vWNorm).y);
            // The glow rides the paint weight: molten veins light up exactly
            // where their texture is on the ground (terrain.ts adds this into
            // totalEmissiveRadiance).
            wocPaintEmis = (wocEmisAcc / wocPaintN) * wocPaintW;
          }
        }`;

/**
 * The painted texture's OWN relief, injected in the normal_fragment_maps
 * section (after `wocDetailN` is in scope). ONE centre tap of the field +
 * ONE of the normal array, gated by the SAME near-distance fade the splat's
 * own detail normals use — relief mips toward flat past that range anyway,
 * so paying 8 array taps per fragment at every distance (the first cut of
 * this feature) bought nothing visible and cost real frame time on a fully
 * auto-retextured map. Feathered boundaries stay an albedo concern; a
 * hard-edged normal at a cell border is invisible under the albedo blend.
 */
export const PAINT_NORMAL_GLSL = `
        if (wocPaintW > 0.001 && wocDetailN > 0.0) {
          vec2 wocPnCell = (vWPos.xz - uPaintGrid.xy) * uPaintGrid.z;
          vec2 wocPnCuv = wocPnCell / uPaintDims;
          if (wocPnCuv.x >= 0.0 && wocPnCuv.x < 1.0 && wocPnCuv.y >= 0.0 && wocPnCuv.y < 1.0) {
            vec4 wocPnF = texture2D(uPaintField, wocPnCuv);
            float wocPnRaw = floor(wocPnF.r * 255.0 + 0.5);
            float wocPnSlot = wocPnRaw - 128.0 * step(128.0, wocPnRaw);
            if (wocPnRaw < 250.0) {
              float wocPnPeriod = uPaintTileSizes[int(wocPnSlot)];
              vec2 wocPnN =
                texture(uPaintNormTiles, vec3(vWPos.xz / wocPnPeriod, wocPnSlot)).xy * 2.0 - 1.0;
              normal = normalize(
                normal + tbn * vec3(wocPnN * (wocPaintW * wocDetailN * 1.35), 0.0));
            }
          }
        }`;
