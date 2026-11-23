// Pure authoring decisions for the Cut tool (the Tunnel tool's Hole and Patch
// modes): what solid a click makes, and what a panel edit turns it into.
// DOM-free and deterministic, so app.ts stays a coordinator and the shape
// arithmetic is testable on its own.
//
// v1 only had one shape, so "punch a hole" meant "drop a sphere of the brush
// radius", and a cave mouth that followed a cliff face, an arch, or a slot
// canyon was not expressible. The brush below carries a shape plus the two
// proportions a maker actually reaches for (how long, how tall, relative to
// the brush), which is what turns the ball into a vocabulary.
//
// Everything it emits goes through sanitizeTerrainCut on save, so the clamps
// here and the document's clamps are the same numbers by construction.

import {
  CUT_MAX_ARCH,
  CUT_MAX_BEND,
  CUT_MAX_BLEND,
  CUT_MAX_HALF,
  CUT_MAX_WARP,
  CUT_MAX_WOBBLE,
  CUT_MIN_HALF,
  CUT_TAPER_MAX,
  CUT_TAPER_MIN,
  CUT_WARP_SCALE_DEFAULT,
  CUT_WARP_SCALE_MAX,
  CUT_WARP_SCALE_MIN,
  CUT_WOBBLE_LEN_DEFAULT,
  CUT_WOBBLE_LEN_MAX,
  CUT_WOBBLE_LEN_MIN,
  HOLE_MAX_RADIUS,
  HOLE_MIN_RADIUS,
  sanitizeTerrainCut,
} from '../sim/terrain_cuts';
import type { TerrainCut } from '../sim/types';

/** The shapes a maker can place directly. `tube` is not here on purpose: a
 *  tube cut comes from a cave's own bore (sim/caves.ts caveBoreCut), which is
 *  a far better gesture than asking someone to author a chain by hand. */
export type CutBrushShape = 'sphere' | 'box' | 'capsule';

/** The Caves tool's sub-modes: lay a cave rig, carve real interiors, cut
 *  sheet openings, patch ground back, paint remesh detail, drag the
 *  volumetric Dig/Fill brushes, or the edge-rounding Smooth brush. */
export type TunnelMode =
  | 'dig'
  | 'carve'
  | 'hole'
  | 'patch'
  | 'remesh'
  | 'sculpt'
  | 'fill'
  | 'smooth';

export const CUT_BRUSH_SHAPES: readonly CutBrushShape[] = ['sphere', 'box', 'capsule'];

export interface CutBrush {
  shape: CutBrushShape;
  /** Yaw the solid is dropped at, radians. The tool passes the camera's
   *  heading so a slot lines up with what the maker is looking at. */
  rotY: number;
  /** Pitch, radians: what lets a slot follow a cliff face instead of dropping
   *  straight down. */
  rotX: number;
  /** Length along the local X as a multiple of the brush radius. */
  lengthMult: number;
  /** Height as a multiple of the brush radius. */
  heightMult: number;
  /** Smooth-union radius in yards: melts this cut into its neighbours. */
  blend: number;
  // FORK: organic shaping (see TerrainCut). Undulation amplitude in yards and
  // its feature size; capsule taper / wobble / wobble period / bend / arch.
  warp: number;
  warpScale: number;
  taper: number;
  wobble: number;
  wobbleLen: number;
  bend: number;
  arch: number;
}

export const DEFAULT_CUT_BRUSH: CutBrush = {
  shape: 'sphere',
  rotY: 0,
  rotX: 0,
  lengthMult: 2,
  heightMult: 1,
  blend: 0,
  warp: 0,
  warpScale: CUT_WARP_SCALE_DEFAULT,
  taper: 1,
  wobble: 0,
  wobbleLen: CUT_WOBBLE_LEN_DEFAULT,
  bend: 0,
  arch: 0,
};

/** Slider ranges the panel reads, so a control can never author a value the
 *  sanitizer would clamp away on the next load. */
export const CUT_BRUSH_LIMITS = {
  lengthMult: { min: 0.25, max: 24, step: 0.05 },
  heightMult: { min: 0.25, max: 8, step: 0.05 },
  blend: { min: 0, max: CUT_MAX_BLEND, step: 0.25 },
  warp: { min: 0, max: CUT_MAX_WARP, step: 0.1 },
  warpScale: { min: CUT_WARP_SCALE_MIN, max: CUT_WARP_SCALE_MAX, step: 0.5 },
  taper: { min: CUT_TAPER_MIN, max: CUT_TAPER_MAX, step: 0.05 },
  wobble: { min: 0, max: CUT_MAX_WOBBLE, step: 0.02 },
  wobbleLen: { min: CUT_WOBBLE_LEN_MIN, max: CUT_WOBBLE_LEN_MAX, step: 0.5 },
  bend: { min: -CUT_MAX_BEND, max: CUT_MAX_BEND, step: 0.02 },
  arch: { min: -CUT_MAX_ARCH, max: CUT_MAX_ARCH, step: 0.02 },
} as const;

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

function clampRadius(r: number): number {
  return clamp(r, HOLE_MIN_RADIUS, HOLE_MAX_RADIUS);
}

function clampHalf(v: number): number {
  return clamp(v, CUT_MIN_HALF, CUT_MAX_HALF);
}

/**
 * The solid one click makes: centred on the clicked point at the surface
 * height captured there, sized by the brush radius. `y` anchors it, so
 * re-sculpting nearby ground never smears the opening.
 */
export function makeCut(
  brush: CutBrush,
  x: number,
  surfaceY: number,
  z: number,
  radius: number,
): TerrainCut {
  const r = clampRadius(radius);
  const base: TerrainCut = { x, y: surfaceY, z, radius: r };
  if (brush.blend > 0) base.blend = clamp(brush.blend, 0, CUT_MAX_BLEND);
  if (brush.rotY !== 0) base.rotY = brush.rotY;
  if (brush.rotX !== 0) base.rotX = brush.rotX;
  // FORK: shaping dials ride every shape (undulation) or the capsule alone.
  if (brush.warp > 0) {
    base.warp = clamp(brush.warp, 0, CUT_MAX_WARP);
    if (brush.warpScale !== CUT_WARP_SCALE_DEFAULT) {
      base.warpScale = clamp(brush.warpScale, CUT_WARP_SCALE_MIN, CUT_WARP_SCALE_MAX);
    }
  }
  const capsuleShape: Partial<TerrainCut> = {};
  if (brush.taper !== 1) capsuleShape.taper = clamp(brush.taper, CUT_TAPER_MIN, CUT_TAPER_MAX);
  if (brush.wobble > 0) {
    capsuleShape.wobble = clamp(brush.wobble, 0, CUT_MAX_WOBBLE);
    if (brush.wobbleLen !== CUT_WOBBLE_LEN_DEFAULT) {
      capsuleShape.wobbleLen = clamp(brush.wobbleLen, CUT_WOBBLE_LEN_MIN, CUT_WOBBLE_LEN_MAX);
    }
  }
  if (brush.bend !== 0) capsuleShape.bend = clamp(brush.bend, -CUT_MAX_BEND, CUT_MAX_BEND);
  if (brush.arch !== 0) capsuleShape.arch = clamp(brush.arch, -CUT_MAX_ARCH, CUT_MAX_ARCH);
  switch (brush.shape) {
    case 'box':
      return {
        ...base,
        shape: 'box',
        halfX: clampHalf(r * brush.lengthMult),
        halfY: clampHalf(r * brush.heightMult),
        halfZ: clampHalf(r),
      };
    case 'capsule':
      return {
        ...base,
        shape: 'capsule',
        len: clamp(r * brush.lengthMult, 0, CUT_MAX_HALF),
        vert: clamp(brush.heightMult, 0.1, 8),
        ...capsuleShape,
      };
    default:
      return base;
  }
}

/** What the panel shows for one placed cut. */
export interface CutSummary {
  index: number;
  /** True for a Carve-tool solid (real interior); false for a v1 hole. */
  carve: boolean;
  shape: CutBrushShape | 'tube' | 'voxel';
  radius: number;
  blend: number;
  /** A carve's interior texture-set key (null = default granite) + tiling. */
  tex: string | null;
  texTile: number | null;
  /** Length and height as MULTIPLES of the radius, which is how the sliders
   *  present them: a maker resizes the cut and its proportions follow. */
  lengthMult: number;
  heightMult: number;
  rotY: number;
  rotX: number;
  // FORK: shaping dials, brush defaults when absent.
  warp: number;
  warpScale: number;
  taper: number;
  wobble: number;
  wobbleLen: number;
  bend: number;
  arch: number;
}

export function cutSummary(cut: TerrainCut, index: number): CutSummary {
  const r = cut.radius || 1;
  const shape = cut.shape ?? 'sphere';
  return {
    index,
    carve: cut.carve === true,
    shape,
    radius: cut.radius,
    blend: cut.blend ?? 0,
    tex: cut.tex ?? null,
    texTile: cut.texTile ?? null,
    lengthMult:
      shape === 'box'
        ? (cut.halfX ?? r) / r
        : shape === 'capsule'
          ? (cut.len ?? 0) / r
          : DEFAULT_CUT_BRUSH.lengthMult,
    heightMult:
      shape === 'box'
        ? (cut.halfY ?? r) / r
        : shape === 'capsule'
          ? (cut.vert ?? 1)
          : DEFAULT_CUT_BRUSH.heightMult,
    rotY: cut.rotY ?? 0,
    rotX: cut.rotX ?? 0,
    warp: cut.warp ?? 0,
    warpScale: cut.warpScale ?? CUT_WARP_SCALE_DEFAULT,
    taper: cut.taper ?? 1,
    wobble: cut.wobble ?? 0,
    wobbleLen: cut.wobbleLen ?? CUT_WOBBLE_LEN_DEFAULT,
    bend: cut.bend ?? 0,
    arch: cut.arch ?? 0,
  };
}

export interface CutChange {
  radius?: number;
  blend?: number;
  lengthMult?: number;
  heightMult?: number;
  rotY?: number;
  rotX?: number;
  shape?: CutBrushShape;
  warp?: number;
  warpScale?: number;
  taper?: number;
  wobble?: number;
  wobbleLen?: number;
  bend?: number;
  arch?: number;
}

/**
 * A panel edit applied to a cut, as a NEW record (the caller owns undo, so
 * nothing here mutates). Proportions are preserved across a resize and across
 * a shape swap: a maker who has tuned a slot to be long and shallow keeps
 * those proportions when they widen it or turn it into a capsule.
 *
 * A `tube` cut (a cave's self-carved mouth) is derived, not authored, so it is
 * returned untouched.
 */
export function applyCutChange(cut: TerrainCut, change: CutChange): TerrainCut {
  if (cut.shape === 'tube' || cut.shape === 'voxel') return cut;
  const before = cutSummary(cut, 0);
  const shape = change.shape ?? before.shape;
  if (shape === 'tube' || shape === 'voxel') return cut;
  const brush: CutBrush = {
    shape,
    rotY: change.rotY ?? before.rotY,
    rotX: change.rotX ?? before.rotX,
    lengthMult: clamp(
      change.lengthMult ?? before.lengthMult,
      CUT_BRUSH_LIMITS.lengthMult.min,
      CUT_BRUSH_LIMITS.lengthMult.max,
    ),
    heightMult: clamp(
      change.heightMult ?? before.heightMult,
      CUT_BRUSH_LIMITS.heightMult.min,
      CUT_BRUSH_LIMITS.heightMult.max,
    ),
    blend: clamp(change.blend ?? before.blend, 0, CUT_MAX_BLEND),
    warp: clamp(change.warp ?? before.warp, 0, CUT_MAX_WARP),
    warpScale: clamp(change.warpScale ?? before.warpScale, CUT_WARP_SCALE_MIN, CUT_WARP_SCALE_MAX),
    taper: clamp(change.taper ?? before.taper, CUT_TAPER_MIN, CUT_TAPER_MAX),
    wobble: clamp(change.wobble ?? before.wobble, 0, CUT_MAX_WOBBLE),
    wobbleLen: clamp(change.wobbleLen ?? before.wobbleLen, CUT_WOBBLE_LEN_MIN, CUT_WOBBLE_LEN_MAX),
    bend: clamp(change.bend ?? before.bend, -CUT_MAX_BEND, CUT_MAX_BEND),
    arch: clamp(change.arch ?? before.arch, -CUT_MAX_ARCH, CUT_MAX_ARCH),
  };
  const out = makeCut(brush, cut.x, cut.y, cut.z, change.radius ?? cut.radius);
  // The carve flag is identity, not proportion: a panel edit never turns a
  // room back into a v1 sheet cutout. The interior texture rides the same
  // rule, resizing a room must not strip its rock.
  if (cut.carve === true) out.carve = true;
  if (cut.tex !== undefined) out.tex = cut.tex;
  if (cut.texTile !== undefined) out.texTile = cut.texTile;
  return out;
}

/** Whether two cuts describe the same solid. applyCutChange always returns a
 *  NEW record (the caller owns undo), so identity says nothing: a commit needs
 *  this to tell a real edit from a slider that landed back where it started
 *  and must not push an undo step. */
export function sameCut(a: TerrainCut, b: TerrainCut): boolean {
  if (a === b) return true;
  const fa = a as unknown as Record<string, unknown>;
  const fb = b as unknown as Record<string, unknown>;
  const keys = new Set([...Object.keys(fa), ...Object.keys(fb)]);
  for (const key of keys) {
    if (key === 'nodes') continue;
    if (fa[key] !== fb[key]) return false;
  }
  const an = a.nodes;
  const bn = b.nodes;
  if (!an || !bn) return an === bn;
  if (an.length !== bn.length) return false;
  return an.every((n, i) => {
    const o = bn[i];
    return n.x === o.x && n.y === o.y && n.z === o.z && n.radius === o.radius && n.vy === o.vy;
  });
}

/** Round-trip guard for the authoring path: what the document will hold after
 *  a save, so the tool and the loaded map can never disagree. */
export function normalizeAuthoredCut(cut: TerrainCut): TerrainCut {
  return sanitizeTerrainCut(cut) ?? cut;
}
