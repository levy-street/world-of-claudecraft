// The spirit veil's program family: which programs a veiled rig can draw,
// named as TUPLES of the per-object facts three (0.185.1) folds into their
// cache keys, plus the transparent sort that draws each ghost rig as one unit.
//
// The veil (ghost_veil.ts) mounts one unlit colour material per rig material
// and a depth-only sibling per rig mesh. Both keep a CONSTANT custom program
// key and carry nothing per character, so every ghost in the game resolves to
// the tuples below and only to them: the boot entry (spirit_veil_prewarm.ts)
// links one stand-in per tuple, and a veil whose tuples are all linked commits
// on the frame the ghost appears. What varies between two draws of the same
// veil material is only what three reads off the OBJECT: skinning, the morph
// target count and kinds, the normal and position attributes, instancing and
// batching; plus, for the colour arms, whether the source had a map (the veil
// carries the source map and nothing else). Light counts, fog, tone mapping and
// the output colour space are global to a tier and shared by every program.
//
// The list is pinned against the shipped catalogue by
// tests/spirit_veil_census.test.ts: a new part whose morph count or attribute
// set is not listed fails CI there, not a live frame. A tuple nobody listed
// still never links live (the effect gate stages it), it just stops being
// immediate.
//
// Three-free and deterministic: tests drive it directly.

/** The three draws a veiled rig can make. `depth` is the colour-write-free
 *  pre-pass, `color` the blended body, `decal` the alpha-preserving variant
 *  a transparent face decal wears over the veiled head. */
export type SpiritVeilPass = 'depth' | 'color' | 'decal';

/** The object facts three re-derives a veil program from. */
export interface SpiritVeilShape {
  skinned: boolean;
  /** three's morphTargetsCount: the length of the first present morph list. */
  morphTargets: number;
  /** three's morphTargets bit: a position morph list is present, even empty. */
  morphPositions: boolean;
  morphNormals: boolean;
  morphColors: boolean;
  normals: boolean;
  positions: boolean;
  instanced: boolean;
  batched: boolean;
}

/** The structural slice of a THREE.Mesh the shape is read from. */
export interface SpiritVeilShapeObject {
  isSkinnedMesh?: boolean;
  isInstancedMesh?: boolean;
  isBatchedMesh?: boolean;
  geometry?: {
    attributes?: { position?: unknown; normal?: unknown };
    morphAttributes?: {
      position?: readonly unknown[];
      normal?: readonly unknown[];
      color?: readonly unknown[];
    };
  };
}

/** Read a mesh's veil shape the way WebGLPrograms.getParameters reads it. */
export function spiritVeilShapeOf(object: SpiritVeilShapeObject): SpiritVeilShape {
  const morphs = object.geometry?.morphAttributes;
  const counted = morphs?.position || morphs?.normal || morphs?.color;
  return {
    skinned: object.isSkinnedMesh === true,
    morphTargets: counted ? counted.length : 0,
    morphPositions: morphs?.position !== undefined,
    morphNormals: morphs?.normal !== undefined,
    morphColors: morphs?.color !== undefined,
    normals: Boolean(object.geometry?.attributes?.normal),
    positions: Boolean(object.geometry?.attributes?.position),
    instanced: object.isInstancedMesh === true,
    batched: object.isBatchedMesh === true,
  };
}

/** One program of the family, in its canonical form (normals and positions
 *  present, position morphs only, no instancing or batching). */
export interface SpiritVeilTuple {
  pass: SpiritVeilPass;
  skinned: boolean;
  /** The colour arms only: the depth pass carries no map. */
  map: boolean;
  morphTargets: number;
}

/**
 * The tuple key of one veil draw. The canonical facts spell the tuple; any
 * other fact three reads is appended as a flag, so a shape the family cannot
 * reproduce keys as a tuple nothing lists. Equal keys are the same program on
 * the same tier; different keys are different programs. `mapChannel` is the
 * source map's uv channel (three's mapUv); the family maps on channel 0.
 */
export function spiritVeilTupleKey(
  pass: SpiritVeilPass,
  shape: SpiritVeilShape,
  map: boolean,
  mapChannel = 0,
): string {
  const mapped = pass !== 'depth' && map;
  let key = `${pass}:${shape.skinned ? 's' : 'r'}${mapped ? '+map' : ''}:${shape.morphTargets}`;
  if (mapped && mapChannel !== 0) key += `!uv${mapChannel}`;
  if (shape.morphPositions && shape.morphTargets === 0) key += '!morphempty';
  if (!shape.normals) key += '!nonormal';
  if (!shape.positions) key += '!noposition';
  if (shape.morphNormals) key += '!morphnormal';
  if (shape.morphColors) key += '!morphcolor';
  if (shape.instanced) key += '!instanced';
  if (shape.batched) key += '!batched';
  return key;
}

/** The key of a canonical tuple. */
export function spiritVeilKeyOfTuple(tuple: SpiritVeilTuple): string {
  return spiritVeilTupleKey(tuple.pass, canonicalShape(tuple), tuple.map);
}

function canonicalShape(tuple: SpiritVeilTuple): SpiritVeilShape {
  return {
    skinned: tuple.skinned,
    morphTargets: tuple.morphTargets,
    morphPositions: tuple.morphTargets > 0,
    morphNormals: false,
    morphColors: false,
    normals: true,
    positions: true,
    instanced: false,
    batched: false,
  };
}

/** The canonical tuple a key names, or null when the key carries a flag no
 *  stand-in reproduces (or is not a veil key at all). */
export function spiritVeilTupleOfKey(key: string): SpiritVeilTuple | null {
  const match = /^(depth|color|decal):([sr])(\+map)?:(\d+)$/.exec(key);
  if (!match) return null;
  const tuple: SpiritVeilTuple = {
    pass: match[1] as SpiritVeilPass,
    skinned: match[2] === 's',
    map: match[3] !== undefined,
    morphTargets: Number(match[4]),
  };
  return spiritVeilKeyOfTuple(tuple) === key ? tuple : null;
}

const MORPHS_SKINNED_NO_MAP = [0, 4, 6, 7, 8, 9, 12, 14, 17];

/**
 * The pinned family. Colour: the skinned and rigid rig parts of the catalogue
 * (the composed body's merged parts, class rigs, the mech, weapons, shields,
 * the baked far mesh), map or not, at every morph count the composed library
 * ships. Decal: the stubble, scalp and makeup decals, cut from the composed
 * head and so carrying its morph count. Depth: every shape above, the map
 * collapsed. tests/spirit_veil_census.test.ts derives the same list from the
 * shipped GLBs and requires equality.
 */
export const SPIRIT_VEIL_FAMILY: readonly SpiritVeilTuple[] = [
  { pass: 'color', skinned: true, map: true, morphTargets: 0 },
  { pass: 'color', skinned: true, map: true, morphTargets: 14 },
  ...MORPHS_SKINNED_NO_MAP.map(
    (morphTargets): SpiritVeilTuple => ({ pass: 'color', skinned: true, map: false, morphTargets }),
  ),
  { pass: 'color', skinned: false, map: true, morphTargets: 0 },
  { pass: 'color', skinned: false, map: false, morphTargets: 0 },
  { pass: 'decal', skinned: true, map: true, morphTargets: 17 },
  ...MORPHS_SKINNED_NO_MAP.map(
    (morphTargets): SpiritVeilTuple => ({ pass: 'depth', skinned: true, map: false, morphTargets }),
  ),
  { pass: 'depth', skinned: false, map: false, morphTargets: 0 },
];

export const SPIRIT_VEIL_FAMILY_KEYS: ReadonlySet<string> = new Set(
  SPIRIT_VEIL_FAMILY.map(spiritVeilKeyOfTuple),
);

/** Whether a veil draw needing `keys` may commit without staging. */
export function spiritVeilKeysLinked(
  keys: readonly string[],
  linked: ReadonlySet<string>,
): boolean {
  for (const key of keys) if (!linked.has(key)) return false;
  return true;
}

// --- the transparent sort ---------------------------------------------------

/** userData key of the sort unit a veiled draw belongs to. */
export const SPIRIT_VEIL_UNIT_KEY = 'spiritVeilUnit';
/** userData key of the pass a veiled draw makes inside its unit. */
export const SPIRIT_VEIL_PASS_KEY = 'spiritVeilPass';

/** Draw order inside one unit: the depth pre-pass first, then the body, then
 *  the decals the body's depth lets through. */
export const SPIRIT_VEIL_PASS_ORDER: Readonly<Record<SpiritVeilPass, number>> = {
  depth: 0,
  color: 1,
  decal: 2,
};

/** One ghost rig in the sort. `z` is cached per render (`stamp`). */
export interface SpiritVeilSortUnit {
  readonly id: number;
  stamp: number;
  z: number;
}

let nextUnitId = 1;

export function createSpiritVeilSortUnit(): SpiritVeilSortUnit {
  return { id: nextUnitId++, stamp: Number.NaN, z: 0 };
}

/** The slice of a three render item the sort reads. */
export interface SpiritVeilSortItem {
  id: number;
  groupOrder: number;
  renderOrder: number;
  z: number;
  object: { userData: Record<string, unknown> };
}

/**
 * A transparent sort that is three's reversePainterSortStable for every item
 * outside a veil unit, and draws each unit as ONE block at one depth among
 * them: all of the rig's depth pre-pass, then its body, then its decals. The
 * unit takes the depth of the first of its draws the sort meets in a render
 * (`frame` changes once per render call), so every comparison inside one sort
 * sees the same value and the order stays total. A unit's draws sit in the
 * default band (renderOrder 0): a camera-faded wall or a water surface nearer
 * than the rig draws after it and over it, and the rig draws after (and so
 * over) what stands behind it.
 */
export function createSpiritVeilTransparentSort(
  frame: () => number,
): (a: SpiritVeilSortItem, b: SpiritVeilSortItem) => number {
  const unitZ = (unit: SpiritVeilSortUnit, item: SpiritVeilSortItem): number => {
    const now = frame();
    if (unit.stamp !== now) {
      unit.stamp = now;
      unit.z = item.z;
    }
    return unit.z;
  };
  return (a, b) => {
    if (a.groupOrder !== b.groupOrder) return a.groupOrder - b.groupOrder;
    const ua = a.object.userData[SPIRIT_VEIL_UNIT_KEY] as SpiritVeilSortUnit | undefined;
    const ub = b.object.userData[SPIRIT_VEIL_UNIT_KEY] as SpiritVeilSortUnit | undefined;
    const ra = ua ? 0 : a.renderOrder;
    const rb = ub ? 0 : b.renderOrder;
    if (ra !== rb) return ra - rb;
    const za = ua ? unitZ(ua, a) : a.z;
    const zb = ub ? unitZ(ub, b) : b.z;
    if (za !== zb) return zb - za;
    const ia = ua ? ua.id : 0;
    const ib = ub ? ub.id : 0;
    if (ia !== ib) return ia - ib;
    if (ua) {
      const pa = SPIRIT_VEIL_PASS_ORDER[a.object.userData[SPIRIT_VEIL_PASS_KEY] as SpiritVeilPass];
      const pb = SPIRIT_VEIL_PASS_ORDER[b.object.userData[SPIRIT_VEIL_PASS_KEY] as SpiritVeilPass];
      if (pa !== pb) return (pa ?? 1) - (pb ?? 1);
    }
    return a.id - b.id;
  };
}
