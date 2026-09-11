// The Tree Generator's parameter record: pure data, shared by the renderer
// (src/render/tree_gen.ts, which grows the mesh), the map document (map_doc.ts,
// which sanitizes it off untrusted JSON) and the editor panel (which drives it).
//
// It lives in sim/ because the sim and the server must never import src/render.
// Nothing here knows about three.js; it is limits, defaults and clamping.
//
// A tree placement carries ONE of these under `tree`, rather than thirty flat
// fields on the placement, because the generator has genuinely that many knobs
// and a nested record keeps them together through save, load, copy and undo.

/** One canopy ellipsoid, in trunk-local yards (Y up), centred on the trunk. */
export interface TreeVolume {
  x: number;
  y: number;
  z: number;
  /** Horizontal radius. */
  r: number;
  /** Vertical radius as a multiple of r (1 = a sphere). */
  sy: number;
}

/** How the canopy volumes are laid out when the maker has not moved them. */
export type TreeCanopyShape =
  | 'sockets' // one blob per limb tip: follows the trunk's real branching
  | 'sphere' // one big ball, the storybook broadleaf
  | 'dome' // flat-bottomed, heavier on top
  | 'cone' // stacked and shrinking upward: conifers
  | 'umbrella' // a wide flat plate: acacia, parasol
  | 'column' // tall and narrow: cypress, poplar
  | 'weeping'; // stretched downward, for hanging strands

export const TREE_SHAPES: readonly TreeCanopyShape[] = [
  'sockets',
  'sphere',
  'dome',
  'cone',
  'umbrella',
  'column',
  'weeping',
];

/** Which way a leaf card points. */
export type TreeLeafOrient =
  | 'volume' // out along the canopy surface normal (the natural look)
  | 'up' // stems down, blades up
  | 'out' // splayed horizontally outward
  | 'random' // fully random tumble
  | 'droop' // outward then pitched down under its own weight
  | 'billboard'; // always facing the camera

export const TREE_LEAF_ORIENTS: readonly TreeLeafOrient[] = [
  'volume',
  'up',
  'out',
  'droop',
  'random',
  'billboard',
];

export interface TreeParams {
  seed?: number;
  /** Foundation trunk key (render/tree_trunks.generated.ts). */
  trunk?: string;
  /** Trunk girth multiplier (x/z). */
  girth?: number;
  /** Trunk height multiplier (y). Sockets and canopy follow it. */
  height?: number;

  // ---- branches
  /** Child branches grown per socket. 0 = the foundation limbs alone. */
  branches?: number;
  branchDepth?: number;
  branchLen?: number;
  branchAngle?: number;
  branchDroop?: number;
  branchTwist?: number;
  branchTaper?: number;

  // ---- canopy volumes
  shape?: TreeCanopyShape;
  volumeCount?: number;
  /** Horizontal spread of the auto-laid-out volumes, as a multiple of the
   *  trunk's authored crown radius. */
  volumeSpread?: number;
  /** Vertical offset of the canopy centre, in yards. */
  volumeRise?: number;
  /** Size multiplier on every auto volume. */
  volumeScale?: number;
  volumeJitter?: number;
  /** Explicit volumes. Once the maker edits a sphere these become
   *  authoritative and the shape preset stops regenerating them. */
  volumes?: readonly TreeVolume[];

  // ---- leaves
  leafSet?: string;
  leaves?: number;
  leafSize?: number;
  leafSizeVar?: number;
  leafOrient?: TreeLeafOrient;
  /** 0 = cards on the volume's shell only, 1 = filled solid through it. */
  leafFill?: number;
  leafDroop?: number;
  leafJitter?: number;
  /** Clumps leaves into bunches instead of scattering them evenly. */
  leafClump?: number;
  /** Pulls the scatter toward the branch tips rather than the volume centres. */
  leafBranchBias?: number;
  /** Multiply tint over the painted card (0xffffff = the atlas as painted). */
  leafTint?: number;
  leafTintVar?: number;
  /** Emissive strength: magic and fire canopies light themselves. */
  leafGlow?: number;
  /** Two quads crossed per leaf: costlier, but a canopy with real volume. */
  leafCross?: boolean;

  // ---- bark
  barkTexId?: string;
  barkTile?: number;

  // ---- wind
  /** Sway strength multiplier (0 = dead still, 1 = the game's default). */
  sway?: number;

  /** Collision radius multiplier on the trunk's own girth (0 = walk through). */
  collide?: number;
}

/** Hard ceiling on leaf cards per tree: a maker dragging a slider must not be
 *  able to author a placement that costs a hundred thousand quads. */
export const MAX_TREE_LEAVES = 1400;
export const MAX_TREE_VOLUMES = 12;
export const DEFAULT_BARK_TILE = 4;

/**
 * Every numeric knob with its slider range. The panel reads these so a slider
 * can never author a value the sanitizer would clamp away on the next load,
 * and the sanitizer reads them so an untrusted map cannot smuggle one in.
 */
export const TREE_LIMITS = {
  girth: { min: 0.25, max: 3, step: 0.05 },
  height: { min: 0.3, max: 3, step: 0.05 },
  branches: { min: 0, max: 6, step: 1 },
  branchDepth: { min: 1, max: 3, step: 1 },
  branchLen: { min: 0.2, max: 3, step: 0.05 },
  branchAngle: { min: 0, max: 1.6, step: 0.02 },
  branchDroop: { min: 0, max: 1.5, step: 0.02 },
  branchTwist: { min: 0, max: 1.5, step: 0.02 },
  branchTaper: { min: 0.2, max: 0.95, step: 0.01 },
  volumeCount: { min: 1, max: MAX_TREE_VOLUMES, step: 1 },
  volumeSpread: { min: 0.2, max: 2.5, step: 0.05 },
  volumeRise: { min: -6, max: 12, step: 0.1 },
  volumeScale: { min: 0.25, max: 2.5, step: 0.05 },
  volumeJitter: { min: 0, max: 1, step: 0.02 },
  leaves: { min: 0, max: MAX_TREE_LEAVES, step: 10 },
  leafSize: { min: 0.15, max: 6, step: 0.05 },
  leafSizeVar: { min: 0, max: 1, step: 0.02 },
  leafFill: { min: 0, max: 1, step: 0.02 },
  leafDroop: { min: 0, max: 1.5, step: 0.02 },
  leafJitter: { min: 0, max: 1, step: 0.02 },
  leafClump: { min: 0, max: 1, step: 0.02 },
  leafBranchBias: { min: 0, max: 1, step: 0.02 },
  leafTintVar: { min: 0, max: 1, step: 0.02 },
  leafGlow: { min: 0, max: 8, step: 0.1 },
  barkTile: { min: 0.2, max: 12, step: 0.05 },
  sway: { min: 0, max: 2.5, step: 0.05 },
  collide: { min: 0, max: 3, step: 0.05 },
} as const;

export type TreeNumericKey = keyof typeof TREE_LIMITS;

/** A parameter record with every field filled in. */
export type ResolvedTreeParams = Required<Omit<TreeParams, 'volumes'>> & {
  volumes: readonly TreeVolume[];
};

export const DEFAULT_TREE_PARAMS: ResolvedTreeParams = {
  seed: 0,
  trunk: 'oak',
  girth: 1,
  height: 1,
  branches: 2,
  branchDepth: 1,
  branchLen: 1,
  branchAngle: 0.6,
  branchDroop: 0.25,
  branchTwist: 0.3,
  branchTaper: 0.55,
  shape: 'sockets',
  volumeCount: 5,
  volumeSpread: 1,
  volumeRise: 0,
  volumeScale: 1,
  volumeJitter: 0.35,
  volumes: [],
  leafSet: 'broadleaf',
  leaves: 340,
  leafSize: 1.9,
  leafSizeVar: 0.3,
  leafOrient: 'volume',
  leafFill: 0.18,
  leafDroop: 0.35,
  leafJitter: 0.5,
  leafClump: 0.3,
  leafBranchBias: 0.35,
  leafTint: 0xffffff,
  leafTintVar: 0.18,
  leafGlow: 0,
  leafCross: false,
  barkTexId: 'Wood003',
  barkTile: DEFAULT_BARK_TILE,
  sway: 1,
  collide: 1,
};

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** Asset-key shape shared by the trunk, leaf-set and texture-set ids. Format
 *  only: the sim stays render-free, so an unknown key simply falls back to the
 *  default at build time rather than failing the load. */
const KEY_RE = /^[A-Za-z0-9_]{1,40}$/;

/**
 * Sanitize a `tree` record off an untrusted map. Returns null when there is
 * nothing usable, so the caller can leave the field off entirely.
 */
export function sanitizeTreeParams(raw: unknown): TreeParams | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  const out: TreeParams = {};
  if (finite(p.seed)) out.seed = Math.round(clamp(p.seed, 0, 1e9));
  if (typeof p.trunk === 'string' && KEY_RE.test(p.trunk)) out.trunk = p.trunk;
  if (typeof p.leafSet === 'string' && KEY_RE.test(p.leafSet)) out.leafSet = p.leafSet;
  if (typeof p.barkTexId === 'string' && KEY_RE.test(p.barkTexId)) out.barkTexId = p.barkTexId;
  if (typeof p.shape === 'string' && (TREE_SHAPES as readonly string[]).includes(p.shape)) {
    out.shape = p.shape as TreeCanopyShape;
  }
  if (
    typeof p.leafOrient === 'string' &&
    (TREE_LEAF_ORIENTS as readonly string[]).includes(p.leafOrient)
  ) {
    out.leafOrient = p.leafOrient as TreeLeafOrient;
  }
  for (const key of Object.keys(TREE_LIMITS) as TreeNumericKey[]) {
    const v = p[key];
    if (!finite(v)) continue;
    const lim = TREE_LIMITS[key];
    const clamped = clamp(v, lim.min, lim.max);
    (out as Record<string, number>)[key] = lim.step >= 1 ? Math.round(clamped) : clamped;
  }
  if (finite(p.leafTint)) out.leafTint = Math.round(clamp(p.leafTint, 0, 0xffffff));
  if (p.leafCross === true) out.leafCross = true;
  if (Array.isArray(p.volumes)) {
    const volumes: TreeVolume[] = [];
    for (const rawV of p.volumes.slice(0, MAX_TREE_VOLUMES)) {
      if (!rawV || typeof rawV !== 'object') continue;
      const v = rawV as Record<string, unknown>;
      if (!finite(v.x) || !finite(v.y) || !finite(v.z) || !finite(v.r)) continue;
      volumes.push({
        x: clamp(v.x, -60, 60),
        y: clamp(v.y, -20, 90),
        z: clamp(v.z, -60, 60),
        r: clamp(v.r, 0.1, 40),
        sy: finite(v.sy) ? clamp(v.sy, 0.1, 4) : 1,
      });
    }
    if (volumes.length > 0) out.volumes = volumes;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** Fill in every unset field. Callers work with a complete record. */
export function resolvedTreeParams(p: TreeParams | undefined): ResolvedTreeParams {
  return { ...DEFAULT_TREE_PARAMS, ...(p ?? {}) };
}
