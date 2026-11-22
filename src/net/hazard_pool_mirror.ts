// The online client's mirror of boss-dropped ground pools (world_api
// HazardPoolView). The server sends each pool's position and identity on the
// delve run record (`drun.bossPools`), never its clock, so the record stays
// static and resends only when a pool appears or goes. The client has no server
// clock, so a pool's age is counted locally from when this mirror first saw it
// (the riftDeathZone mirror's precedent): it can run a round trip late, which
// only shifts the cosmetic spill, never where the pool lies. A pool is listed
// for exactly as long as the server keeps sending it.

import { blackwaterMarkPoolView, NO_HAZARD_POOLS } from '../sim/delves/boss_pool_views';
import type { DelveBossPoolInfo } from '../world_api/delves';
import type { HazardPoolView } from '../world_api/dungeons';

export class HazardPoolMirror {
  /** Pool id -> the local ms it was first seen. */
  private readonly firstSeen = new Map<number, number>();
  private readonly seenNow = new Set<number>();

  /** The live rows for the pools the server currently sends, aged locally. */
  views(pools: readonly DelveBossPoolInfo[] | undefined, nowMs: number): readonly HazardPoolView[] {
    if (!pools || pools.length === 0) {
      if (this.firstSeen.size) this.firstSeen.clear();
      return NO_HAZARD_POOLS;
    }
    this.seenNow.clear();
    const out: HazardPoolView[] = [];
    for (const pool of pools) {
      let since = this.firstSeen.get(pool.id);
      if (since === undefined) {
        since = nowMs;
        this.firstSeen.set(pool.id, since);
      }
      this.seenNow.add(pool.id);
      out.push(blackwaterMarkPoolView(pool, (nowMs - since) / 1000));
    }
    // Forget pools the server stopped sending, so a reused id starts fresh.
    for (const id of this.firstSeen.keys()) if (!this.seenNow.has(id)) this.firstSeen.delete(id);
    return out;
  }
}
