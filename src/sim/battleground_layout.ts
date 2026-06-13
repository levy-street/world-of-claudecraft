// Ravenrift — the 5v5 capture-the-flag battleground. Plain-data map geometry
// (instance-local coordinates, y up, z along the length), the single source of
// truth shared by BOTH the collider set (src/sim/colliders.ts) and the renderer
// (src/render/battleground.ts), so what you fight around is what you see.
// Sim layer: no three.js imports.
import type { Collider } from './colliders';

export type Team = 0 | 1; // 0 = Crimson (south, -z), 1 = Azure (north, +z)
export const TEAM_NAMES = ['Crimson', 'Azure'] as const;
export const TEAM_COLORS = [0xd1413a, 0x3a78d1] as const; // red, blue — flags/banners/blips

// Field footprint. The play area is a walled rectangle; the two keeps sit at
// the short ends with their flag at the heart of a three-sided enclosure.
export const BG_HALF_X = 34;
export const BG_HALF_Z = 60;
export const BG_WALL_T = 1; // wall half-thickness (collider + module)
export const BG_WALL_HEIGHT = 6;
export const FLAG_Z = 48; // |z| of each team's flag stand

export interface BaseDef {
  team: Team;
  flag: { x: number; z: number }; // flag home + capture point
  spawns: { x: number; z: number }[]; // respawn ring behind the flag
  banner: { x: number; z: number };
}

// Crimson keep opens toward +z (the field); Azure mirrors it on +z.
export const BASES: BaseDef[] = [
  {
    team: 0,
    flag: { x: 0, z: -FLAG_Z },
    spawns: [{ x: -6, z: -54 }, { x: 0, z: -55 }, { x: 6, z: -54 }, { x: -3, z: -51 }, { x: 3, z: -51 }],
    banner: { x: 0, z: -56 },
  },
  {
    team: 1,
    flag: { x: 0, z: FLAG_Z },
    spawns: [{ x: 6, z: 54 }, { x: 0, z: 55 }, { x: -6, z: 54 }, { x: 3, z: 51 }, { x: -3, z: 51 }],
    banner: { x: 0, z: 56 },
  },
];

// Speed runes: one at each flag section plus two mid-field flanks. Stepping on
// an active rune grants a sprint buff; it then recharges (see sim BG_RUNE_*).
export const SPEED_RUNES: { x: number; z: number }[] = [
  { x: 0, z: -36 }, // Crimson flag approach
  { x: 0, z: 36 }, // Azure flag approach
  { x: -24, z: 0 }, // west flank
  { x: 24, z: 0 }, // east flank
];

// Central cover — staggered walls, a heart ruin, pillars and crate stacks that
// break line of sight and carve out flanking lanes to weave enemies through.
interface WallSeg { x: number; z: number; hw: number; hd: number; rot?: number }
export const COVER_WALLS: WallSeg[] = [
  { x: 0, z: 0, hw: 5, hd: 5 }, // heart ruin block
  { x: -13, z: -16, hw: 1, hd: 8 }, // offset lane walls
  { x: 13, z: 16, hw: 1, hd: 8 },
  { x: 13, z: -16, hw: 1, hd: 5 },
  { x: -13, z: 16, hw: 1, hd: 5 },
  { x: -22, z: -30, hw: 6, hd: 1 }, // wing baffles near each base mouth
  { x: 22, z: 30, hw: 6, hd: 1 },
];
export const COVER_PILLARS: { x: number; z: number }[] = [
  { x: -18, z: -8 }, { x: 18, z: -8 }, { x: -18, z: 8 }, { x: 18, z: 8 },
  { x: 0, z: -26 }, { x: 0, z: 26 },
];
export const COVER_CRATES: { x: number; z: number }[] = [
  { x: -8, z: -32 }, { x: 8, z: 32 }, { x: 9, z: -22 }, { x: -9, z: 22 },
];

const PILLAR_R = 1.0;
const CRATE_R = 0.8;

/** Full BG collision set in instance-local coordinates. Flag stands and speed
 *  runes are deliberately walkable (no collider). */
export function battlegroundColliders(): Collider[] {
  const out: Collider[] = [];
  // perimeter
  for (const sx of [-BG_HALF_X, BG_HALF_X]) {
    out.push({ type: 'obb', x: sx, z: 0, hw: BG_WALL_T, hd: BG_HALF_Z, rot: 0 });
  }
  for (const sz of [-BG_HALF_Z, BG_HALF_Z]) {
    out.push({ type: 'obb', x: 0, z: sz, hw: BG_HALF_X, hd: BG_WALL_T, rot: 0 });
  }
  // keeps: a three-sided enclosure around each flag, open toward centre
  for (const base of BASES) {
    const dir = base.team === 0 ? -1 : 1; // back wall is further from centre
    const backZ = base.flag.z + dir * 8;
    out.push({ type: 'obb', x: 0, z: backZ, hw: 14, hd: BG_WALL_T, rot: 0 });
    for (const sx of [-14, 14]) {
      out.push({ type: 'obb', x: sx, z: base.flag.z + dir * 2, hw: BG_WALL_T, hd: 6, rot: 0 });
    }
  }
  // central cover
  for (const w of COVER_WALLS) out.push({ type: 'obb', x: w.x, z: w.z, hw: w.hw, hd: w.hd, rot: w.rot ?? 0 });
  for (const p of COVER_PILLARS) out.push({ type: 'circle', x: p.x, z: p.z, r: PILLAR_R });
  for (const c of COVER_CRATES) out.push({ type: 'circle', x: c.x, z: c.z, r: CRATE_R });
  return out;
}
