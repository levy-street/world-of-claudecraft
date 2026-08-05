// Source Cave contributor-mob display resolution, shared by every UI surface
// that shows a cave mob's name or rank (today: the hud.ts target frame; the
// render-side nameplate painter consumes the same sim-edge rank resolver).
//
// A Source Cave mob's templateId is a synthesized `source_cave_<login>` never
// registered in the static MOBS table
// (src/sim/source_cave/templates.ts), so every generic `MOBS[templateId]` lookup
// (display name, elite/boss flags) silently reads as absent/false for these
// mobs. Entity itself carries no elite/boss field (only MobTemplate does), so
// rank is resolved by extracting the login from templateId and correlating it
// against `world.sourceCaveInfo().mobs` (SourceCaveMobDisplay: the same login,
// plus its real elite/boss flags), a lookup already exposed on IWorld with no
// widening needed. Entity.name stays display-only because Source Cave mobs can
// opt into custom names.
//
// isSourceCaveMobEntity itself lives in src/sim/source_cave (re-exported below),
// not here: it needs no IWorld access, and src/CLAUDE.md's dependency direction
// only sanctions render/ reaching into ui/ for the i18n + icon surface, not an
// arbitrary pure core, so the one predicate BOTH render/nameplate_painter.ts and
// this file must agree on has to live on the sim/ edge both layers may import.
// The rank correlation is pure too, so it shares the same sim-edge home. This
// wrapper only supplies the IWorld projection used by the target frame.
//
// DOM-free / i18n-free / deterministic: registered in UI_PURE_CORES
// (tests/architecture.test.ts) and driven directly by tests/source_cave_mob_core.test.ts.

import { type SourceCaveMobRank, sourceCaveMobRankForTemplate } from '../sim/source_cave';
import type { Entity } from '../sim/types';
import type { IWorld } from '../world_api';

export type { SourceCaveMobRank } from '../sim/source_cave';
export { isSourceCaveMobEntity } from '../sim/source_cave';

const rankCache = new WeakMap<IWorld, Map<string, SourceCaveMobRank>>();

/**
 * The cave mob's elite/boss rank, resolved from the world's roster projection
 * correlated by login. Absent roster (info null, e.g. before the cave exists)
 * or no matching entry reads as a plain (non-elite, non-boss) mob rather than
 * throwing, so a caller can call this unconditionally once isSourceCaveMobEntity
 * is true.
 */
export function sourceCaveMobRank(entity: Entity, world: IWorld): SourceCaveMobRank {
  const cached = rankCache.get(world)?.get(entity.templateId);
  if (cached) return cached;
  const info = world.sourceCaveInfo();
  const rank = sourceCaveMobRankForTemplate(entity.templateId, info?.mobs);
  // The roster is immutable for one world. Do not cache a pre-boot null projection,
  // so the first real snapshot can still populate the rank.
  if (info) {
    let worldRanks = rankCache.get(world);
    if (!worldRanks) {
      worldRanks = new Map();
      rankCache.set(world, worldRanks);
    }
    worldRanks.set(entity.templateId, rank);
  }
  return rank;
}
