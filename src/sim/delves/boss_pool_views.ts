// Boss-dropped ground pools as presentation rows: the pure half both worlds
// share (no SimContext). Sister Nhalia's Blackwater Mark is the first source;
// its timing constants live here so the boss driver and the readouts read one
// definition. Nothing here decides a hit: drowned_litany_boss.ts still owns the
// damage, the cadence and every rng draw. These rows only say where a pool lies
// and how old it is, for the renderer's hazard pool host
// (src/render/hazard_pool/) to draw.

import type { DelveBossPoolInfo } from '../../world_api/delves';
import type { HazardPoolView } from '../../world_api/dungeons';
import type { DrownedLitanyBlackwaterMark } from '../types';

export const BLACKWATER_MARK_RADIUS = 4;
export const BLACKWATER_MARK_DURATION = 8;
export const BLACKWATER_MARK_TICK = 1;

/** The shared empty answer, so a per-frame reader with nothing down allocates
 *  nothing. Never mutated by a reader (the world API hands it out readonly). */
export const NO_HAZARD_POOLS: readonly HazardPoolView[] = Object.freeze([]);

/** The wire rows for a run's live marks: position and identity only, never the
 *  clock, so the record stays byte-identical for a pool's whole life. */
export function blackwaterMarkPoolInfos(
  marks: readonly DrownedLitanyBlackwaterMark[],
): DelveBossPoolInfo[] {
  return marks.map((m) => ({ id: m.bornTick ?? -1, x: m.x, z: m.z, r: BLACKWATER_MARK_RADIUS }));
}

/** One Blackwater Mark as a hazard pool row, aged by the caller's clock. */
export function blackwaterMarkPoolView(pool: DelveBossPoolInfo, ageSec: number): HazardPoolView {
  return {
    id: `blackwater_mark:${pool.id}`,
    x: pool.x,
    z: pool.z,
    r: pool.r,
    style: 'violet',
    ageSec: Math.max(0, ageSec),
    armSec: BLACKWATER_MARK_TICK,
    lifeSec: BLACKWATER_MARK_DURATION,
  };
}

/** The offline world's rows: exact ages straight from the marks' own clocks. */
export function blackwaterMarkPoolViews(
  marks: readonly DrownedLitanyBlackwaterMark[],
): readonly HazardPoolView[] {
  if (marks.length === 0) return NO_HAZARD_POOLS;
  const infos = blackwaterMarkPoolInfos(marks);
  return infos.map((info, i) =>
    blackwaterMarkPoolView(info, BLACKWATER_MARK_DURATION - marks[i].remaining),
  );
}
