// The static collider set of an authored field, in instance-local yards:
// generated cliff walls, authored walls, and prop footprints. Built once per
// def (the interior collider seam caches it). Gate colliders are NOT here:
// they belong to the dungeon's gate list (instances/dungeon_gates.ts), which
// appends them tagged with their gate id.

import type { Collider } from '../../colliders';
import { authoredFieldCliffRuns } from './cliffs';
import { authoredFieldHeight } from './height';
import type { AuthoredFieldDef } from './types';

/** Half thickness of a generated cliff wall. */
export const CLIFF_HALF_DEPTH = 0.45;
/** Extra length past each end of a run, so two runs meeting at a corner seal it. */
const CLIFF_END_PAD = 0.5;

export function authoredFieldColliders(def: AuthoredFieldDef, floorY: number): Collider[] {
  const out: Collider[] = [];
  for (const run of authoredFieldCliffRuns(def)) {
    const dx = run.bx - run.ax;
    const dz = run.bz - run.az;
    const len = Math.hypot(dx, dz);
    out.push({
      type: 'obb',
      x: (run.ax + run.bx) / 2,
      z: (run.az + run.bz) / 2,
      hw: len / 2 + CLIFF_END_PAD,
      hd: CLIFF_HALF_DEPTH,
      rot: Math.atan2(-dz, dx),
      cameraTopY: floorY + run.high + 2,
    });
  }
  for (const w of def.walls) {
    out.push({
      type: 'obb',
      x: w.x,
      z: w.z,
      hw: w.hw,
      hd: w.hd,
      rot: w.rot,
      cameraTopY: floorY + authoredFieldHeight(def, w.x, w.z) + w.height,
    });
  }
  for (const p of def.props) {
    const top = floorY + authoredFieldHeight(def, p.x, p.z) + (p.h ?? 6);
    if (p.r !== undefined && p.r > 0) {
      out.push({ type: 'circle', x: p.x, z: p.z, r: p.r, cameraTopY: top });
    } else if (p.hw !== undefined && p.hd !== undefined && p.hw > 0 && p.hd > 0) {
      out.push({ type: 'obb', x: p.x, z: p.z, hw: p.hw, hd: p.hd, rot: p.rot, cameraTopY: top });
    }
  }
  return out;
}
