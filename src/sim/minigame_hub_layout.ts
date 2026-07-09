// The Proving Grounds (the Athenaeum of Trials) furniture layout: the collidable
// set pieces the renderer places in the hub room, authored ONCE here so the
// renderer (render/minigame_hub.ts) and the sim collision (colliders.ts) read
// the SAME anchors: what you see is what you collide with. Instance-local
// coordinates (relative to MINIGAME_HUB); colliders.ts subtracts the origin
// first. Pure data-as-derivation: no rng, no three.js, no DOM.

import type { Collider } from './colliders';
import { MINIGAME_HUB_RADIUS } from './data';

export type HubFurnitureKind = 'bookcaseA' | 'bookcaseB' | 'tableRound' | 'tableLong' | 'chair';

export interface HubFurniture {
  kind: HubFurnitureKind;
  x: number;
  z: number;
  /** yaw, three.js rotation.y convention (shared by the render mesh and the OBB). */
  rot: number;
}

// The bookcase ring: cabinets on a radius just inside the wall, faces turned
// inward, with the south arc (toward the doorway) left open for the portals.
const BOOKCASE_COUNT = 12;
const BOOKCASE_RADIUS = MINIGAME_HUB_RADIUS - 0.9;
/** The doorway arc kept clear of bookcases (the renderer leaves it open too). */
export const HUB_SOUTH_CLEAR = Math.PI * 0.22;

// The two reading nooks (round tables mirrored east/west of the rug) and the
// long study table behind the heralds (north). Anchors match the renderer.
const NOOK_X = 8.5;
const NOOK_Z = -1.5;
const LONG_TABLE_Z = 11.5;

/** Every collidable set piece in the hub, instance-local. The renderer iterates
 * this list to place the meshes; minigameHubColliders() derives a collider from
 * each, so the placed prop and its collider can never drift apart. */
export function minigameHubFurniture(): HubFurniture[] {
  const out: HubFurniture[] = [];
  // Bookcases ringing the wall, faces turned inward, south arc left open.
  for (let i = 0; i < BOOKCASE_COUNT; i++) {
    const a = (i / BOOKCASE_COUNT) * Math.PI * 2;
    if (Math.abs(Math.atan2(Math.sin(a), Math.cos(a)) - Math.PI) < HUB_SOUTH_CLEAR) continue;
    out.push({
      kind: i % 2 === 0 ? 'bookcaseA' : 'bookcaseB',
      x: Math.sin(a) * BOOKCASE_RADIUS,
      z: Math.cos(a) * BOOKCASE_RADIUS,
      rot: a + Math.PI, // back to the wall, shelves toward the centre
    });
  }
  // Two reading nooks: a round table flanked by two chairs, east and west.
  for (const side of [-1, 1]) {
    const tx = side * NOOK_X;
    const tz = NOOK_Z;
    out.push({ kind: 'tableRound', x: tx, z: tz, rot: 0 });
    out.push({ kind: 'chair', x: tx + side * 1.4, z: tz + 0.6, rot: -side * Math.PI * 0.4 });
    out.push({ kind: 'chair', x: tx - side * 0.4, z: tz - 1.5, rot: side * Math.PI * 0.8 });
  }
  // The long study table behind the heralds.
  out.push({ kind: 'tableLong', x: 0, z: LONG_TABLE_Z, rot: 0 });
  return out;
}

function circle(x: number, z: number, r: number): Collider {
  return { type: 'circle', x, z, r };
}

function obb(x: number, z: number, hw: number, hd: number, rot: number): Collider {
  return { type: 'obb', x, z, hw, hd, rot };
}

let cache: Collider[] | null = null;

/** The hub's static furniture colliders, instance-local (relative to
 * MINIGAME_HUB). Built once; every entry mirrors a set piece the renderer
 * places from minigameHubFurniture(). Footprint half-extents are matched to the
 * placed mesh's scaled bounding box closely enough that a mover collides with
 * what it sees: bookcases and the long table are boxes (OBB, sharing the mesh's
 * rot); the round tables and chairs are circles. */
export function minigameHubColliders(): Collider[] {
  if (cache) return cache;
  const out: Collider[] = [];
  for (const f of minigameHubFurniture()) {
    switch (f.kind) {
      case 'bookcaseA':
      case 'bookcaseB':
        // A double bookcase: wide along its own local x (tangential to the ring),
        // shallow in depth. The OBB shares the mesh's rot.
        out.push(obb(f.x, f.z, 1.7, 0.5, f.rot));
        break;
      case 'tableRound':
        out.push(circle(f.x, f.z, 0.9));
        break;
      case 'tableLong':
        out.push(obb(f.x, f.z, 1.5, 0.6, f.rot));
        break;
      case 'chair':
        out.push(circle(f.x, f.z, 0.45));
        break;
    }
  }
  cache = out;
  return out;
}
