// Is water NEAR the player? The underwater view arms its compile gate on this
// answer, ahead of the camera ever reaching a waterline: from a dock, a cliff
// top or a first-person camera the camera is not over water until the dive
// itself, so "the camera is over water" leaves no lead to link in.
//
// The probe reads the sim's waterline on a WORLD-ALIGNED lattice, over the
// disc of lattice points around the one nearest the player. A cold read of a
// sea cell costs a full terrain sample (heavy-tailed, up to most of a
// millisecond), so the reads are spread: a bounded few per call, a cursor that
// keeps cycling the disc while the player's lattice point moves, and no read
// at all once a full cycle has run from where the player stands.

/** Yards around the player's lattice point the probe looks for water. */
export const WATER_APPROACH_RADIUS = 60;
/** Lattice pitch (yards). Water holding a disc of radius pitch / sqrt(2)
 *  anywhere in the probed disc covers at least one lattice point; the
 *  smallest authored lake's footprint is wider than that. */
export const WATER_APPROACH_PITCH = 12;
/** Waterline reads one call may take: the per-frame cost bound. It must let a
 *  full cycle of the disc finish before the fastest mover crosses one lattice
 *  cell at a low frame rate: a slower cycle lets the moving disc skip the same
 *  world point cycle after cycle, so a pond can go unseen until reached. */
export const WATER_APPROACH_READS_PER_CALL = 5;

/** The sim's waterline read (`waterLevelAt`): -Infinity off water. */
export type WaterLevelAt = (x: number, z: number, seed: number) => number;

export interface WaterApproachProbe {
  /** True from the first read that found water within the radius of the
   *  lattice point nearest the player (it latches). */
  near(x: number, z: number, seed: number): boolean;
  /** Waterline reads taken so far. */
  readonly reads: number;
}

function latticeDisc(): Int32Array {
  const steps = Math.floor(WATER_APPROACH_RADIUS / WATER_APPROACH_PITCH);
  const out: number[] = [];
  for (let i = -steps; i <= steps; i++) {
    for (let j = -steps; j <= steps; j++) {
      if (i * i + j * j <= steps * steps) out.push(i, j);
    }
  }
  return Int32Array.from(out);
}

const DISC = latticeDisc();
/** Lattice points in the probed disc: one full cycle of reads. */
export const WATER_APPROACH_DISC_POINTS = DISC.length / 2;

export function createWaterApproachProbe(levelAt: WaterLevelAt): WaterApproachProbe {
  let centerI = Number.NaN;
  let centerJ = Number.NaN;
  let cursor = 0;
  let pending = 0;
  let found = false;
  let reads = 0;
  return {
    get reads() {
      return reads;
    },
    near(x: number, z: number, seed: number): boolean {
      if (found) return true;
      const ci = Math.round(x / WATER_APPROACH_PITCH);
      const cj = Math.round(z / WATER_APPROACH_PITCH);
      if (ci !== centerI || cj !== centerJ) {
        centerI = ci;
        centerJ = cj;
        // The cursor carries on rather than restarting, so a player whose
        // lattice point moves faster than a cycle still gets every offset read.
        pending = WATER_APPROACH_DISC_POINTS;
      }
      for (let n = 0; n < WATER_APPROACH_READS_PER_CALL && pending > 0; n++) {
        const sx = (ci + DISC[cursor * 2]) * WATER_APPROACH_PITCH;
        const sz = (cj + DISC[cursor * 2 + 1]) * WATER_APPROACH_PITCH;
        cursor = (cursor + 1) % WATER_APPROACH_DISC_POINTS;
        pending--;
        reads++;
        if (Number.isFinite(levelAt(sx, sz, seed))) {
          found = true;
          return true;
        }
      }
      return false;
    },
  };
}
