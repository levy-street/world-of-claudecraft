// The Foliage Generator's parameter record: TreeParams generalized to every
// plant the generator grows, not only trees. Pure data, shared by the renderer
// (src/render/foliage_gen.ts, which grows the mesh), the map document
// (map_doc.ts, which sanitizes it off untrusted JSON) and the editor panel.
//
// It lives in sim/ for the same reason TreeParams does: the sim and the server
// must never import src/render. Nothing here knows about three.js.
//
// WHY THIS EXISTS. Trees were parameterised and everything else was not:
// bushes and grass were separate hard-coded systems in render/foliage.ts, so a
// maker who wanted a slightly different bush had no dial to turn. The trunk
// and branch solver only applies to some plants, but the canopy solver, the
// leaf scatter, the atlas and the sway all apply to all of them, which is
// exactly the split `kind` draws:
//
//   tree    trunk GLB + branch chain + canopy volumes            (the v1 path)
//   bush    no trunk chain, canopy volumes sitting on the ground
//   fern    a spray of fronds from one root, no trunk
//   vine    strands hanging from an anchor, canopy along them
//   grass   a blade scatter over a footprint, no leaf cards at all
//
// A record with no `kind` is a tree, so every existing document, preset and
// placement keeps working untouched.

import {
  MAX_TREE_LEAVES,
  type ResolvedTreeParams,
  resolvedTreeParams,
  sanitizeTreeParams,
  TREE_LIMITS,
  type TreeNumericKey,
  type TreeParams,
} from './tree_params';

export type FoliageKind = 'tree' | 'bush' | 'grass' | 'fern' | 'vine';

export const FOLIAGE_KINDS: readonly FoliageKind[] = ['tree', 'bush', 'grass', 'fern', 'vine'];

/** Which kinds grow from a trunk GLB and its branch chain. The others share
 *  the canopy/leaf half of the solver and skip the trunk half entirely. */
export function foliageHasTrunk(kind: FoliageKind): boolean {
  return kind === 'tree';
}

/** Grass is the one kind with no leaf cards: it is blade geometry, so the
 *  leaf-set, orientation and atlas dials do not apply to it. */
export function foliageHasLeafCards(kind: FoliageKind): boolean {
  return kind !== 'grass';
}

export interface FoliageParams extends TreeParams {
  /** Absent = 'tree', which is what every v1 record is. */
  kind?: FoliageKind;
  /** Radius in yards the plant occupies at the ground: the canopy footprint
   *  for a bush or fern, the blade scatter's disc for grass, the anchor's
   *  spread for a vine. Ignored by trees, which take theirs from the trunk. */
  footprint?: number;
  /** Overall height in yards for the kinds with no trunk to scale. */
  plantHeight?: number;
  /** grass: blade clusters scattered over the footprint. */
  clumps?: number;
  /** fern: fronds sprayed from the root. vine: hanging strands. */
  strands?: number;
  /** vine: how far the strands hang below their anchor, in yards. */
  hang?: number;
  /** How much the plant leans out from its own centre, 0 = straight up. */
  splay?: number;
}

export const MAX_GRASS_CLUMPS = 120;
export const MAX_FOLIAGE_STRANDS = 24;

/** The new numeric knobs and their slider ranges, in the same contract as
 *  TREE_LIMITS: the panel reads them so a slider can never author a value the
 *  sanitizer would clamp away, and the sanitizer reads them so an untrusted
 *  map cannot smuggle one in. */
export const FOLIAGE_LIMITS = {
  footprint: { min: 0.2, max: 12, step: 0.05 },
  plantHeight: { min: 0.15, max: 20, step: 0.05 },
  clumps: { min: 1, max: MAX_GRASS_CLUMPS, step: 1 },
  strands: { min: 1, max: MAX_FOLIAGE_STRANDS, step: 1 },
  hang: { min: 0.2, max: 24, step: 0.1 },
  splay: { min: 0, max: 1.5, step: 0.02 },
} as const;

export type FoliageNumericKey = keyof typeof FOLIAGE_LIMITS;

export type ResolvedFoliageParams = ResolvedTreeParams &
  Required<Omit<FoliageParams, keyof TreeParams>>;

/**
 * Per-kind defaults. Only the fields that differ from the tree baseline are
 * listed, so the shared solver's behaviour stays visibly one thing with five
 * settings rather than five parallel generators.
 */
export const FOLIAGE_KIND_DEFAULTS: Record<FoliageKind, Partial<ResolvedFoliageParams>> = {
  tree: {},
  bush: {
    // No trunk chain, one squat canopy sitting on the ground.
    shape: 'dome',
    volumeCount: 3,
    branches: 0,
    leaves: 150,
    leafSize: 0.75,
    leafFill: 0.45,
    footprint: 1.6,
    plantHeight: 1.5,
    splay: 0.35,
  },
  grass: {
    // Blades, not cards: the leaf dials are inert here (foliageHasLeafCards).
    leaves: 0,
    footprint: 1.1,
    plantHeight: 0.55,
    clumps: 14,
    splay: 0.5,
  },
  fern: {
    shape: 'umbrella',
    volumeCount: 2,
    branches: 0,
    leaves: 90,
    leafSize: 1.1,
    leafOrient: 'droop',
    leafDroop: 0.9,
    leafFill: 0.15,
    footprint: 1.3,
    plantHeight: 1.1,
    strands: 7,
    splay: 0.85,
  },
  vine: {
    shape: 'weeping',
    volumeCount: 2,
    branches: 0,
    leaves: 170,
    leafSize: 0.6,
    leafOrient: 'droop',
    leafFill: 0.25,
    footprint: 1.0,
    plantHeight: 0.6,
    strands: 6,
    hang: 4,
    splay: 0.2,
  },
};

const BASE_EXTRA_DEFAULTS: Required<Omit<FoliageParams, keyof TreeParams>> = {
  kind: 'tree',
  footprint: 1.5,
  plantHeight: 1.5,
  clumps: 12,
  strands: 6,
  hang: 3,
  splay: 0.3,
};

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** The kind a record describes. Absent means tree, which is the v1 contract. */
export function foliageKindOf(p: FoliageParams | undefined): FoliageKind {
  const kind = p?.kind;
  return kind && FOLIAGE_KINDS.includes(kind) ? kind : 'tree';
}

/**
 * Sanitize a foliage record off an untrusted map. The shared tree fields go
 * through sanitizeTreeParams unchanged, so a v1 `tree` record parses exactly
 * as it always did and this only ever ADDS the new keys.
 */
export function sanitizeFoliageParams(raw: unknown): FoliageParams | null {
  const base = sanitizeTreeParams(raw);
  if (!raw || typeof raw !== 'object') return base;
  const p = raw as Record<string, unknown>;
  const out: FoliageParams = { ...(base ?? {}) };
  if (typeof p.kind === 'string' && (FOLIAGE_KINDS as readonly string[]).includes(p.kind)) {
    // 'tree' carries no information: leaving it off keeps a v1 document
    // byte-identical through a round trip.
    if (p.kind !== 'tree') out.kind = p.kind as FoliageKind;
  }
  for (const key of Object.keys(FOLIAGE_LIMITS) as FoliageNumericKey[]) {
    const v = p[key];
    if (!finite(v)) continue;
    const lim = FOLIAGE_LIMITS[key];
    const clamped = clamp(v, lim.min, lim.max);
    (out as Record<string, number>)[key] = lim.step >= 1 ? Math.round(clamped) : clamped;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** Fill in every unset field, applying the kind's own defaults over the tree
 *  baseline. Callers work with a complete record. */
export function resolvedFoliageParams(p: FoliageParams | undefined): ResolvedFoliageParams {
  const kind = foliageKindOf(p);
  const kindDefaults = FOLIAGE_KIND_DEFAULTS[kind];
  // The kind's defaults sit BETWEEN the baseline and the maker's own values,
  // so an explicitly authored field always wins and an untouched one takes the
  // shape the kind wants.
  const tree = resolvedTreeParams({ ...(kindDefaults as TreeParams), ...(p ?? {}) });
  return {
    ...tree,
    ...BASE_EXTRA_DEFAULTS,
    ...kindDefaults,
    ...stripUndefined(p ?? {}),
    kind,
  } as ResolvedFoliageParams;
}

function stripUndefined(p: FoliageParams): Partial<FoliageParams> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(p)) {
    if (v !== undefined) out[k] = v;
  }
  return out as Partial<FoliageParams>;
}

/** Every numeric limit the panel can show for a kind: the tree knobs that
 *  still apply, plus the kind's own. */
export function foliageLimitsFor(
  kind: FoliageKind,
): Record<string, { min: number; max: number; step: number }> {
  const out: Record<string, { min: number; max: number; step: number }> = {};
  for (const key of Object.keys(TREE_LIMITS) as TreeNumericKey[]) {
    // Trunk and branch dials mean nothing without a trunk chain; leaf dials
    // mean nothing on blade grass.
    const trunkOnly = key === 'girth' || key === 'height' || key.startsWith('branch');
    const leafOnly = key === 'leaves' || key.startsWith('leaf');
    if (trunkOnly && !foliageHasTrunk(kind)) continue;
    if (leafOnly && !foliageHasLeafCards(kind)) continue;
    out[key] = TREE_LIMITS[key];
  }
  for (const key of Object.keys(FOLIAGE_LIMITS) as FoliageNumericKey[]) {
    if (key === 'clumps' && kind !== 'grass') continue;
    if (key === 'hang' && kind !== 'vine') continue;
    if (key === 'strands' && kind !== 'fern' && kind !== 'vine') continue;
    if ((key === 'footprint' || key === 'plantHeight') && foliageHasTrunk(kind)) continue;
    out[key] = FOLIAGE_LIMITS[key];
  }
  return out;
}

export { MAX_TREE_LEAVES };
