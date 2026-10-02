import { hash2 } from '../rng';
import type { ZonePropsDef } from '../types';

// The Blossom Temple grove: a cherry forest clearing in the Evergarden's
// northwest lawns, with a three-tier temple, a gate arch, a koi pond, a stone
// path and lanterns. Pure layout data, shared by the sim (colliders, via the
// decorProps entries below) and src/render/cherry_grove.ts (the procedural
// geometry), so what is drawn and what blocks movement come from one list.
//
// The site was picked by scanning the zone for the widest flat dry clearing
// away from roads and authored content (about 45 yd of free radius).

export const CHERRY_GROVE_CENTER = { x: 308, z: 1058 };

/** Temple footprint: square base, front faces -z (toward the gate). */
export const CHERRY_TEMPLE = { x: 308, z: 1076, half: 5, rot: Math.PI };

/** The gate arch at the grove's south mouth; pillars stand `halfSpan` off center. */
export const CHERRY_GATE = { x: 308, z: 1034, halfSpan: 3.2, rot: 0 };

/** The koi pond (decorative water disc with a stone rim; walkable edge). */
export const CHERRY_POND = { x: 294, z: 1060, r: 5 };

/** The stone path runs straight from the gate to the temple steps. */
export const CHERRY_PATH = { x: 308, z0: 1031, z1: 1070, halfWidth: 1.4 };

/** Stone lanterns lining the path, in pairs. */
export const CHERRY_LANTERNS: { x: number; z: number }[] = [1040, 1050, 1060].flatMap((z) => [
  { x: 304.5, z },
  { x: 311.5, z },
]);

export interface CherryTreeSpot {
  x: number;
  z: number;
  scale: number;
  rot: number;
  variant: 0 | 1;
}

const keepClear = (x: number, z: number): boolean => {
  if (Math.abs(x - CHERRY_PATH.x) < 4 && z > CHERRY_PATH.z0 - 4 && z < CHERRY_PATH.z1 + 2)
    return false;
  if (
    Math.abs(x - CHERRY_TEMPLE.x) < CHERRY_TEMPLE.half + 5 &&
    Math.abs(z - CHERRY_TEMPLE.z) < CHERRY_TEMPLE.half + 5
  )
    return false;
  if (Math.hypot(x - CHERRY_POND.x, z - CHERRY_POND.z) < CHERRY_POND.r + 3) return false;
  if (Math.hypot(x - CHERRY_GATE.x, z - CHERRY_GATE.z) < 6) return false;
  return true;
};

/** Deterministic cherry tree ring (hash-placed, no rng stream draws). */
export const CHERRY_TREES: CherryTreeSpot[] = (() => {
  const out: CherryTreeSpot[] = [];
  const { x: cx, z: cz } = CHERRY_GROVE_CENTER;
  for (let i = 0; i < 140 && out.length < 56; i++) {
    const a = hash2(i, 17, 9011) * Math.PI * 2;
    const r = 12 + hash2(i, 29, 9013) * 30;
    const x = Math.round((cx + Math.cos(a) * r) * 10) / 10;
    const z = Math.round((cz + Math.sin(a) * r) * 10) / 10;
    if (!keepClear(x, z)) continue;
    if (out.some((t) => Math.hypot(t.x - x, t.z - z) < 4.2)) continue;
    out.push({
      x,
      z,
      scale: 1.5 + hash2(i, 41, 9017) * 0.7,
      rot: hash2(i, 53, 9019) * Math.PI * 2,
      variant: hash2(i, 61, 9021) < 0.5 ? 0 : 1,
    });
  }
  return out;
})();

/**
 * Collider-only decor entries (the `collider:` key prefix tells the props
 * renderer to skip them; the grove draws itself). Merged into
 * EVERGARDEN_PROPS.decorProps.
 */
export const CHERRY_GROVE_COLLIDERS: NonNullable<ZonePropsDef['decorProps']> = [
  {
    key: 'collider:cherryTemple',
    x: CHERRY_TEMPLE.x,
    z: CHERRY_TEMPLE.z,
    rot: CHERRY_TEMPLE.rot,
    r: CHERRY_TEMPLE.half + 1,
    h: 14,
    hw: CHERRY_TEMPLE.half,
    hd: CHERRY_TEMPLE.half,
  },
  ...[-1, 1].map((side) => ({
    key: 'collider:cherryGatePillar',
    x: CHERRY_GATE.x + side * CHERRY_GATE.halfSpan,
    z: CHERRY_GATE.z,
    r: 0.45,
    h: 6,
    terrainCalm: false as const,
  })),
  ...CHERRY_LANTERNS.map((l) => ({
    key: 'collider:cherryLantern',
    x: l.x,
    z: l.z,
    r: 0.4,
    h: 1.8,
    terrainCalm: false as const,
  })),
  // the Katana Table (content/katana_forge.ts KATANA_TABLE; kept literal here
  // to avoid an import cycle through blossom_temple)
  {
    key: 'collider:katanaTable',
    x: 316.5,
    z: 1062,
    r: 1.4,
    h: 1.2,
    hw: 1.2,
    hd: 0.6,
    terrainCalm: false as const,
  },
  ...CHERRY_TREES.map((t) => ({
    key: 'collider:cherryTree',
    x: t.x,
    z: t.z,
    r: 0.3 * t.scale,
    h: 4,
    terrainCalm: false as const,
  })),
];
