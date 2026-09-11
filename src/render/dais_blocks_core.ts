// The DAIS_HEIGHT disc of foundation blocks under a raised boss dais or a
// flanking platform (the Nythraxis sigil stages, v0.42.2): 2u
// floor_foundation_allsides blocks on a 4u grid clipped to the disc, each at
// DAIS_PLATFORM_HEIGHT / 2 y-scale so ground cues (the rift death-zone ring,
// dais_lift.ts) lift by the same shared constant. The sim lifts its floor to
// the same height (dungeon_layout.ts daisLiftAt), so bodies stand ON these
// blocks; there is still no obstacle collider. Block rotation comes from the
// stable per-position hash the dungeon dressing shares (hash2), so a dais
// reads the same on every rebuild.
//
// Pure and three-free (RENDER_PURE_CORES, tests/architecture.test.ts): the
// builder passes its Placements sink; a Vitest passes a recording stub.

import { DAIS_PLATFORM_HEIGHT } from './dais_lift';

/** Stable per-position hash in [0, 1): the dungeon dressing's prop jitter. */
export function hash2(a: number, b: number): number {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

export interface DaisDiscLike {
  x: number;
  z: number;
  r: number;
}

/** What the builder's Placements offers; a test records instead. */
export interface DaisBlockSink {
  add(
    kind: string,
    x: number,
    y: number,
    z: number,
    rot: number,
    scale: [number, number, number],
  ): void;
}

export const DAIS_BLOCK_KIND = 'floor_foundation_allsides';
/** Grid pitch of the blocks. */
export const DAIS_BLOCK_PITCH = 4;
export const DAIS_BLOCK_FOOTPRINT_SCALE = 1.85;

/** The grid half-extent that covers a disc of radius `r`: the loop clips
 *  to the disc, so any radius is covered in full and a wider dais never
 *  turns into a square. */
export function daisBlockHalfExtent(r: number): number {
  return Math.ceil(r / DAIS_BLOCK_PITCH) * DAIS_BLOCK_PITCH;
}

/** Stacks the block disc centred on `d` into the sink. */
export function stackDaisBlocks(sink: DaisBlockSink, d: DaisDiscLike): void {
  const quarter = Math.PI / 2;
  const half = daisBlockHalfExtent(d.r);
  for (let x = -half; x <= half; x += DAIS_BLOCK_PITCH) {
    for (let z = -half; z <= half; z += DAIS_BLOCK_PITCH) {
      if (Math.hypot(x, z) > d.r) continue;
      const rot = Math.floor(hash2(x, z) * 4) * quarter;
      sink.add(DAIS_BLOCK_KIND, d.x + x, 0, d.z + z, rot, [
        DAIS_BLOCK_FOOTPRINT_SCALE,
        DAIS_PLATFORM_HEIGHT / 2,
        DAIS_BLOCK_FOOTPRINT_SCALE,
      ]);
    }
  }
}
