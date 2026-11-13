// The raised ground of an authored room-graph interior (the set-piece citadel
// floors and the two walk-in palaces): the solid risers under every lifted
// room, the stair runs across each door that joins rooms of different lift,
// and the standable ledges. Extracted from dungeon.ts, which calls these while
// it builds an authored floor; the sim derives the matching collision from the
// same layout tables, so what is drawn here is what a body stands on.
//
// A palace cuts all of it from its own painted stone (palace_tile_kit.ts);
// every other authored floor keeps the plain dark slab it shipped with.
import * as THREE from 'three';
import type { DungeonLayout } from '../sim/dungeon_layout';
import { authoredLiftAt, doorRampHalf } from '../sim/rift/authored';
import { palaceSlabBox, palaceSlabMaterial } from './palace_tile_kit';

/** Solid risers under every lifted authored room, plus stair runs across each
 * door that joins rooms of different lift. Box tops follow the same linear
 * ramp authoredLiftAt gives the sim, so what you climb is what the sim
 * stands you on (the sub-step mismatch is the platform stairs' own). */
export function addAuthoredRelief(
  group: THREE.Group,
  layout: DungeonLayout,
  variant: string,
): void {
  const rooms = layout.rooms ?? [];
  const doors = layout.doors ?? [];
  if (!rooms.some((r) => (r.lift ?? 0) !== 0)) return;
  // A palace raises its floors and steps in its own painted stone
  // (palace_tile_kit.ts); every other authored floor keeps the plain slab.
  const palace = palaceSlabMaterial(variant);
  const mat = palace ?? new THREE.MeshLambertMaterial({ color: 0x4a4652, emissive: 0x0a0a12 });
  const boxOf = (w: number, h: number, d: number): THREE.BoxGeometry =>
    palace ? palaceSlabBox(w, h, d) : new THREE.BoxGeometry(w, h, d);
  for (const r of rooms) {
    const lift = r.lift ?? 0;
    if (lift <= 0) continue;
    // Top sits a hair below the tile tops so the slab never z-fights them.
    const riser = new THREE.Mesh(boxOf(r.x1 - r.x0 + 2, lift - 0.02, r.z1 - r.z0 + 2), mat);
    riser.position.set((r.x0 + r.x1) / 2, (lift - 0.02) / 2, (r.z0 + r.z1) / 2);
    riser.receiveShadow = true;
    group.add(riser);
  }
  for (const d of doors) {
    const south = rooms.find((r) => r.z1 === d.z && d.x >= r.x0 && d.x <= r.x1);
    const north = rooms.find((r) => r.z0 === d.z && d.x >= r.x0 && d.x <= r.x1);
    if (south && north) {
      const a = south.lift ?? 0;
      const b = north.lift ?? 0;
      if (a === b) continue;
      const h = doorRampHalf(d.hd, b - a);
      const width = d.hw * 2 + 1;
      const steps = Math.max(4, Math.min(16, Math.round((2 * h) / 0.9)));
      const depth = (2 * h) / steps;
      for (let i = 0; i < steps; i++) {
        const zMid = d.z - h + (i + 0.5) * depth;
        const top = Math.max(0.05, a + ((b - a) * (i + 0.5)) / steps);
        const step = new THREE.Mesh(boxOf(width, top, depth + 0.05), mat);
        step.position.set(d.x, top / 2, zMid);
        step.receiveShadow = true;
        group.add(step);
      }
      continue;
    }
    const west = rooms.find((r) => r.x1 === d.x && d.z >= r.z0 && d.z <= r.z1);
    const east = rooms.find((r) => r.x0 === d.x && d.z >= r.z0 && d.z <= r.z1);
    if (west && east) {
      const a = west.lift ?? 0;
      const b = east.lift ?? 0;
      if (a === b) continue;
      const h = doorRampHalf(d.hw, b - a);
      const width = d.hd * 2 + 1;
      const steps = Math.max(4, Math.min(16, Math.round((2 * h) / 0.9)));
      const depth = (2 * h) / steps;
      for (let i = 0; i < steps; i++) {
        const xMid = d.x - h + (i + 0.5) * depth;
        const top = Math.max(0.05, a + ((b - a) * (i + 0.5)) / steps);
        const step = new THREE.Mesh(boxOf(depth + 0.05, top, width), mat);
        step.position.set(xMid, top / 2, d.z);
        step.receiveShadow = true;
        group.add(step);
      }
    }
  }
}

/**
 * The parkour shelves. A ledge is a real standable collider in the sim, so
 * it MUST be drawn: an invisible surface a player vaults onto is worse
 * than no surface at all. Each is a plain stone slab whose TOP sits
 * exactly on the collider's moveTopY, so what the eye reads and what the
 * body stands on are the same plane.
 */
export function addAuthoredLedges(
  group: THREE.Group,
  layout: DungeonLayout,
  variant: string,
): void {
  const ledges = layout.ledges ?? [];
  if (ledges.length === 0) return;
  const rooms = layout.rooms ?? [];
  const doors = layout.doors ?? [];
  // A palace cuts its shelves from its own painted stone (palace_tile_kit.ts).
  const palace = palaceSlabMaterial(variant);
  const mat = palace ?? new THREE.MeshLambertMaterial({ color: 0x6a6270, emissive: 0x0c0a10 });
  const boxOf = (w: number, h: number, d: number): THREE.BoxGeometry =>
    palace ? palaceSlabBox(w, h, d) : new THREE.BoxGeometry(w, h, d);
  const THICK = 0.5;
  for (const l of ledges) {
    const top = authoredLiftAt(rooms, doors, l.x, l.z) + l.top;
    const slab = new THREE.Mesh(boxOf(l.hw * 2, THICK, l.hd * 2), mat);
    slab.position.set(l.x, top - THICK / 2, l.z);
    slab.castShadow = true;
    slab.receiveShadow = true;
    group.add(slab);
    // the bracket under it, so the shelf reads as corbelled off the wall
    // rather than floating in the room
    const post = new THREE.Mesh(boxOf(l.hw * 0.7, top - THICK, l.hd * 0.7), mat);
    post.position.set(l.x, (top - THICK) / 2, l.z);
    post.receiveShadow = true;
    group.add(post);
  }
}
