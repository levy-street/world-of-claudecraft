// The castles' shared stone surfacing. Both fortifications (the Last Keep's
// castle_features.ts and Dawnhold's dawnhold_features.ts) build the same
// kinds of raw mass: wall-walk caps, tower cores, stair wedges, curtain
// footings, and paved yards. Those were flat untextured colors, which read
// as grey cardboard beside the textured KayKit modules bolted onto them.
//
// Course size must stay constant across a castle however big the piece is,
// and the obvious way to get that (one texture per mass size, each carrying
// its own repeat) is a trap: a castle builds hundreds of differently sized
// slabs, so it mints hundreds of 256px canvases at world entry and hangs the
// load. The tiling therefore lives on the GEOMETRY (tileCastleUv scales a
// mesh's uv attribute by its real world size) while the texture stays a
// single shared instance at repeat 1, so the whole castle shares one
// material per stone tone.
//
// Pure presentation: no sim imports, no world state.
import * as THREE from 'three';
import { surfaceMat } from './gfx';
import { castleAshlarTexture, flagstoneTexture } from './textures';

/** world yards covered by one repeat of each texture */
export const STONE_TILE_YD = 4;
export const FLAGSTONE_TILE_YD = 7;

/**
 * The canvas texture set needs a DOM. The castle masses are also built
 * headlessly by the geometry guards (tests/last_keep_face_sink), which
 * measure BOX EXTENTS and care nothing for the surface, so outside a
 * browser the surfacing degrades to plain color instead of throwing.
 */
const hasCanvas = typeof document !== 'undefined';

let ashlar: THREE.Texture | null | undefined;
let paving: THREE.Texture | null | undefined;

function shared(make: () => THREE.CanvasTexture): THREE.Texture | null {
  if (!hasCanvas) return null;
  const tex = make();
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** the one coursed-ashlar albedo every castle mass shares */
export function castleStoneTexture(): THREE.Texture | null {
  if (ashlar === undefined) ashlar = shared(castleAshlarTexture);
  return ashlar;
}

/** the one laid-paving albedo every castle yard shares */
export function castlePavingTexture(): THREE.Texture | null {
  if (paving === undefined) paving = shared(flagstoneTexture);
  return paving;
}

/**
 * Tile a mass's own uv attribute to its real world size, so one shared
 * texture yields a constant course size on a 3yd coping and a 50yd floor
 * alike. Box faces each map 0..1, so this repeats every face the same
 * number of times: correct on the broad faces that read, and harmless on a
 * slab's thin edges.
 */
export function tileCastleUv(
  geo: THREE.BufferGeometry,
  uYd: number,
  vYd: number,
  tileYd = STONE_TILE_YD,
): void {
  const uv = geo.getAttribute('uv');
  if (!uv) return;
  const su = Math.max(0.25, uYd / tileYd);
  const sv = Math.max(0.25, vYd / tileYd);
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  uv.needsUpdate = true;
}

/** Coursed castle stone in the given tone (a mass's masonry). */
export function castleStoneMat(
  opts: { color?: number; roughness?: number; side?: THREE.Side } = {},
): THREE.Material {
  // both castle textures are authored HIGH KEY to be tinted, so the mass's
  // own stone tone goes straight through whether or not a map exists
  return surfaceMat({
    color: opts.color ?? 0x8a7568,
    map: castleStoneTexture() ?? undefined,
    roughness: opts.roughness ?? 0.94,
    side: opts.side,
  });
}

/** Laid paving in the given tone (a castle yard). */
export function castlePavingMat(opts: { color?: number; roughness?: number } = {}): THREE.Material {
  return surfaceMat({
    color: opts.color ?? 0x9a958c,
    map: castlePavingTexture() ?? undefined,
    roughness: opts.roughness ?? 0.96,
  });
}

/**
 * A box mass wearing castle stone: the geometry comes back uv-tiled to its
 * own size so its courses match the rest of the castle.
 */
export function castleStoneBox(w: number, h: number, d: number): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(w, h, d);
  tileCastleUv(geo, Math.max(w, d), Math.max(h, Math.min(w, d)));
  return geo;
}

/** Test-only window into the tiling constants and the DOM gate. */
export const castleStoneInternalsForTest = {
  STONE_TILE_YD,
  FLAGSTONE_TILE_YD,
  hasCanvas,
};
