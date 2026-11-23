// The Wyrm's Hollow plate floor (G25, docs/design/dungeon-rework/
// gravewyrm_sanctum.md section 6.3), pure: no host, no rng. The lake is cut
// into the nineteen LAKE_PLATES; a point on the lake belongs to the plate whose
// centre is nearest (the shelf beyond the lake's radius belongs to none). A
// plate is Sound, Cracked or Broken: fire on a Sound plate cracks it, fire on a
// Cracked plate breaks it, and a Cracked plate left alone refreezes to Sound
// (never on heroic, Deep Quench). One floor height throughout: a broken plate
// is open quench-water in the sim's rules only (the sinking is render only).

import { LAKE_PLATES, WYRMS_HOLLOW } from '../../content/gravewyrm_sanctum_layout';
import { type PlateState, plateTemplate } from './boss_ids';

/** One plate's live state (kept on Korzul's fight state, mirrored into the
 *  template id of its object). */
export interface PlateRec {
  objectId: number;
  state: PlateState;
  /** Seconds a Cracked plate has left before it refreezes (unused otherwise). */
  refreeze: number;
}

/** The plate a lake point (instance-local yards) belongs to: the nearest plate
 *  centre (ties to the lower index), or null on the shelf and beyond. */
export function plateIndexAt(lx: number, lz: number): number | null {
  if (Math.hypot(lx - WYRMS_HOLLOW.x, lz - WYRMS_HOLLOW.z) > WYRMS_HOLLOW.lakeR) return null;
  return nearestPlate(lx, lz);
}

/** The plate whose centre is nearest a point anywhere (ties to the lower
 *  index): a marked player on the shelf still names the plate beside them. */
export function nearestPlate(lx: number, lz: number): number {
  let best = 0;
  let bestD = Number.POSITIVE_INFINITY;
  for (let i = 0; i < LAKE_PLATES.length; i++) {
    const p = LAKE_PLATES[i];
    const d = Math.hypot(lx - p.x, lz - p.z);
    if (d < bestD - 1e-9) {
      best = i;
      bestD = d;
    }
  }
  return best;
}

function wrap(a: number): number {
  let x = a;
  while (x > Math.PI) x -= 2 * Math.PI;
  while (x < -Math.PI) x += 2 * Math.PI;
  return x;
}

/** Is an instance-local point inside a cone from (ox, oz) along `yaw`? */
export function pointInCone(
  ox: number,
  oz: number,
  yaw: number,
  range: number,
  arcDeg: number,
  px: number,
  pz: number,
): boolean {
  const d = Math.hypot(px - ox, pz - oz);
  if (d > range) return false;
  if (d < 1e-6) return true;
  const half = (arcDeg * Math.PI) / 360;
  return Math.abs(wrap(Math.atan2(px - ox, pz - oz) - yaw)) <= half;
}

/** Sample points of a plate's disc: its centre and two rings (half and most
 *  of its radius, eight points each). A cone covers a plate when any lands
 *  in it and that point is nearer the plate than any other plate's centre (the
 *  plate's own cell, so a cone never "covers" a plate it only grazes across a
 *  neighbour's ice). */
function plateSamples(i: number): { x: number; z: number }[] {
  const p = LAKE_PLATES[i];
  const out = [{ x: p.x, z: p.z }];
  for (const k of [0.5, 0.85]) {
    for (let j = 0; j < 8; j++) {
      const a = (j * Math.PI) / 4;
      out.push({ x: p.x + Math.sin(a) * p.r * k, z: p.z + Math.cos(a) * p.r * k });
    }
  }
  return out;
}

/** Does the cone reach into plate `i`'s own ice? */
export function coneCoversPlate(
  ox: number,
  oz: number,
  yaw: number,
  range: number,
  arcDeg: number,
  i: number,
): boolean {
  for (const s of plateSamples(i)) {
    if (plateIndexAt(s.x, s.z) !== i) continue;
    if (pointInCone(ox, oz, yaw, range, arcDeg, s.x, s.z)) return true;
  }
  return false;
}

/** The plates a breath cone burns: every covered plate that is not already
 *  open water and not `exclude` (the plate under the breather), nearest
 *  centre first (ties to the lower index), at most `max`. */
export function conePlates(
  ox: number,
  oz: number,
  yaw: number,
  range: number,
  arcDeg: number,
  max: number,
  states: readonly PlateState[],
  exclude: number | null,
): number[] {
  const hit: { i: number; d: number }[] = [];
  for (let i = 0; i < LAKE_PLATES.length; i++) {
    if (i === exclude || states[i] === 'broken') continue;
    if (!coneCoversPlate(ox, oz, yaw, range, arcDeg, i)) continue;
    hit.push({ i, d: Math.hypot(LAKE_PLATES[i].x - ox, LAKE_PLATES[i].z - oz) });
  }
  hit.sort((a, b) => a.d - b.d || a.i - b.i);
  return hit.slice(0, max).map((h) => h.i);
}

/** Fire on a plate: Sound cracks (its refreeze clock starts), Cracked breaks,
 *  Broken stays open water. Returns the new state. */
export function burnPlate(rec: PlateRec, refreezeSeconds: number): PlateState {
  if (rec.state === 'sound') {
    rec.state = 'cracked';
    rec.refreeze = refreezeSeconds;
  } else if (rec.state === 'cracked') {
    rec.state = 'broken';
    rec.refreeze = 0;
  }
  return rec.state;
}

/** One step of a Cracked plate's refreeze (never on Deep Quench). Returns true
 *  when it froze Sound again this step. */
export function stepRefreeze(rec: PlateRec, dt: number, deep: boolean): boolean {
  if (rec.state !== 'cracked' || deep) return false;
  rec.refreeze -= dt;
  if (rec.refreeze > 1e-9) return false;
  rec.state = 'sound';
  rec.refreeze = 0;
  return true;
}

/** The template id a plate's object carries for its state (a Cracked plate
 *  carries its refreeze clock in tenths of the full time, or `deep`). */
export function plateRecTemplate(rec: PlateRec, refreezeSeconds: number, deep: boolean): string {
  if (rec.state !== 'cracked') return plateTemplate(rec.state);
  if (deep) return plateTemplate('cracked', 'deep');
  return plateTemplate('cracked', (rec.refreeze / refreezeSeconds) * 10);
}

/** How many plates are not open water. */
export function unbrokenPlates(states: readonly PlateState[]): number {
  let n = 0;
  for (const s of states) if (s !== 'broken') n++;
  return n;
}
