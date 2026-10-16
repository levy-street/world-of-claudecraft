// Keep-out circles for a phasing mover (MobTemplate.keepOut).
//
// A phasing mover (MobTemplate.phasesThroughObstacles) walks the straight line through
// every wall, which is the point for a thirteen-yard giant who must never wedge on a tent.
// It also means no wall can keep him OUT of anywhere. Balgath marches on the muster's
// pickets and smashes them, but the command camp (the watchtower and the weapon rack) is
// the one place a player walks up to without standing in his way, so it is a circle his
// feet never cross, whatever pulls him: a warpath leg, a focus-phase chase, a leash
// return, or the walk back to his bed at dusk.
//
// One pure step rule, applied to the step the phasing mover was about to take:
//   - a step that ends outside every circle is untouched (the open-fen case, byte-identical
//     to a mover with no circles at all);
//   - a body already INSIDE a circle (a dev teleport, a circle authored round a spawn)
//     walks straight out along the radius, whatever it was chasing, so it can never be
//     stranded in the one place it must not be;
//   - a destination INSIDE a circle (a player standing at the rack) is chased only to the
//     edge: the step is pulled back onto the rim, so he edges round to the rim point
//     nearest it and stands there;
//   - a destination OUTSIDE a circle the straight line crosses is walked round: the step
//     turns along the rim toward the destination's side and stays on it until the
//     straight line is clear again, so a circle can slow a leg but never end one.
//
// Pure and deterministic (no rng, no clock, no allocation per call: the result is written
// into a caller-owned point). Sim wiring: mob/phase_step.ts.

export interface KeepOutCircle {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
}

export interface MutablePoint {
  x: number;
  z: number;
}

/**
 * Bend one phasing step around every keep-out circle. `from` is where the body stands,
 * `to` where the straight step would put it, `dest` where it is heading; the kept step is
 * written to `out` (which may alias `to`). Returns true when a circle changed the step.
 */
export function keepOutStep(
  circles: readonly KeepOutCircle[],
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
  destX: number,
  destZ: number,
  out: MutablePoint,
): boolean {
  let x = toX;
  let z = toZ;
  let changed = false;
  const step = Math.hypot(toX - fromX, toZ - fromZ);
  for (const c of circles) {
    const dNew = Math.hypot(x - c.x, z - c.z);
    if (dNew >= c.radius) continue;
    changed = true;
    const ox = fromX - c.x;
    const oz = fromZ - c.z;
    const dOld = Math.hypot(ox, oz);
    if (dOld < c.radius - 1e-6) {
      // Inside already: straight out along the radius (due +x from the exact centre).
      const ux = dOld > 1e-9 ? ox / dOld : 1;
      const uz = dOld > 1e-9 ? oz / dOld : 0;
      const r = Math.min(c.radius, dOld + step);
      x = c.x + ux * r;
      z = c.z + uz * r;
      continue;
    }
    const ux = ox / dOld;
    const uz = oz / dOld;
    if (Math.hypot(destX - c.x, destZ - c.z) < c.radius) {
      // Chasing something inside: the step is pulled back onto the rim along its radius,
      // so he edges round to the rim point nearest it and holds there.
      x = c.x + ((x - c.x) / (dNew || 1)) * c.radius;
      z = c.z + ((z - c.z) / (dNew || 1)) * c.radius;
      continue;
    }
    // Round the rim, on the side the destination lies (a fixed side on an exact tie).
    let tx = uz;
    let tz = -ux;
    if (tx * (destX - fromX) + tz * (destZ - fromZ) < 0) {
      tx = -tx;
      tz = -tz;
    }
    const px = fromX + tx * step - c.x;
    const pz = fromZ + tz * step - c.z;
    const pd = Math.hypot(px, pz) || 1;
    x = c.x + (px / pd) * c.radius;
    z = c.z + (pz / pd) * c.radius;
  }
  out.x = x;
  out.z = z;
  return changed;
}

/** Is (x, z) inside any of the circles? */
export function insideKeepOut(circles: readonly KeepOutCircle[], x: number, z: number): boolean {
  for (const c of circles) if (Math.hypot(x - c.x, z - c.z) < c.radius) return true;
  return false;
}
