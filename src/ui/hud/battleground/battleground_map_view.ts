// Pure, host-agnostic model for the M-key world map's Thornhollow Fields surface: the
// field schematic plus the HONEST marker set. Deliberately shown: the walls,
// both flag STANDS (static), the graveyard plots (drawn as ground on the atlas
// plate), yourself, and your TEAMMATES. Deliberately absent: enemies, live flag
// positions, and rune pads, which the view-distance fog and the no-scouting rule
// exist to hide (the map must never out-scout walking there; see the Vision
// design in the PR/wiki). This model therefore emits NO rune-pad markers of any
// kind, and the painter draws none (tests/battleground_map_plan.test.ts pins the
// absence on both sides).
//
// Coordinates are field-LOCAL yards, ORIENTED: your own keep always reads at
// the BOTTOM of the map (the away half is up), so both teams get the same
// mental model. The point-symmetric field makes the flip exact.
//
// DOM-free and i18n-free: the painter owns canvas + tokens.

import { BG_HALF_X, BG_HALF_Z } from '../../../sim/battleground_layout';
import { bgOriginAt, isBgPos } from '../../../sim/data';
import type { BgInfo } from '../../../world_api';

export interface BgMapMate {
  x: number;
  z: number;
  dead: boolean;
  carrying: boolean;
}

export interface BgMapModel {
  active: boolean;
  myTeam: number;
  /** Oriented field-local self marker (facing rotated with the flip). */
  self: { x: number; z: number; facing: number } | null;
  mates: BgMapMate[];
  /** Half-extents of the field, for the painter's fit math. */
  halfX: number;
  halfZ: number;
}

const INACTIVE: BgMapModel = {
  active: false,
  myTeam: 0,
  self: null,
  mates: [],
  halfX: BG_HALF_X,
  halfZ: BG_HALF_Z,
};

interface WorldSlice {
  bgInfo: BgInfo | null;
  playerId: number;
  player: { pos: { x: number; z: number }; facing: number };
  entities: ReadonlyMap<number, { pos: { x: number; z: number }; dead: boolean }>;
}

export function buildBgMapModel(world: WorldSlice): BgMapModel {
  const match = world.bgInfo?.match ?? null;
  const p = world.player;
  if (!match || !isBgPos(p.pos.x)) return INACTIVE;
  const origin = bgOriginAt(p.pos.z);
  // Orientation flip: team 0 (Crimson, keep at -z) reads the field as-is;
  // team 1 sees everything negated so THEIR keep sits at the bottom too.
  const m = match.myTeam === 0 ? 1 : -1;
  const local = (x: number, z: number): { x: number; z: number } => ({
    x: (x - origin.x) * m,
    z: (z - origin.z) * m,
  });
  const mates: BgMapMate[] = [];
  for (const row of match.players) {
    if (row.team !== match.myTeam || row.pid === world.playerId) continue;
    const e = world.entities.get(row.pid);
    if (!e) continue;
    mates.push({ ...local(e.pos.x, e.pos.z), dead: row.dead, carrying: row.carrying });
  }
  return {
    active: true,
    myTeam: match.myTeam,
    self: {
      ...local(p.pos.x, p.pos.z),
      facing: match.myTeam === 0 ? p.facing : p.facing + Math.PI,
    },
    mates,
    halfX: BG_HALF_X,
    halfZ: BG_HALF_Z,
  };
}
