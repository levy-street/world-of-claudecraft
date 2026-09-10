// The Book of Deeds' two join-time passes, moved whole out of Sim.addPlayer
// (the monolith ratchet): the save-blob restore and the retro-on-join credit.
// Both are deeds-domain logic that only ever read module functions from
// deeds.ts / reliquary.ts plus the SimContext seam, so the coordinator keeps
// two one-line calls and this module is what a Vitest drives directly.

import {
  evaluateDeedsFor,
  recomputeRenown,
  restoreDeedStats,
  retroFallbackGrants,
  seedItemDiscovery,
  setActiveBorder,
  setActiveTitle,
  unionLegacyMilestones,
} from './deeds';
import { restoreReliquaryState, seedAccountLedgerSelf } from './reliquary';
import type { CharacterState, PlayerMeta } from './sim';
import type { SimContext } from './sim_context';
import type { Entity } from './types';

/**
 * Restore the Book of Deeds and the Reliquary from a saved character. Earned
 * days load verbatim; the legacy milestone set unions into the earned map
 * (milestone unification); renown is RECOMPUTED from the earned set (the sim
 * is authoritative, the saved number only feeds a SQL sort index). The saved
 * title and border re-apply through the same validators the setter commands
 * use (meta starts untitled and borderless), so a stale id from a content
 * change loads as none instead of riding the entity wire as a dangling
 * reference; both stamp their entity field alongside. The validators read the
 * account ledger too, so a cosmetic an alt earned survives the restore when
 * the host handed the ledger into addPlayer before this runs. A save written
 * before borders existed has no key and lands null.
 */
export function restoreBookOfDeeds(meta: PlayerMeta, player: Entity, s: CharacterState): void {
  for (const [deedId, day] of Object.entries(s.deeds ?? {})) {
    if (typeof day === 'string') meta.deedsEarned.set(deedId, day);
  }
  meta.deedStats = restoreDeedStats(s.deedStats);
  meta.reliquary = restoreReliquaryState(s.reliquary);
  unionLegacyMilestones(meta);
  recomputeRenown(meta);
  setActiveTitle(meta, player, typeof s.activeTitle === 'string' ? s.activeTitle : null);
  setActiveBorder(meta, player, typeof s.activeBorder === 'string' ? s.activeBorder : null);
}

/**
 * Book of Deeds retro-on-join, after the saved state is fully restored: seed
 * the discovery ledger from current holdings, apply the retro fallbacks a
 * predicate cannot express (proof inferences plus the stranded-deed heals),
 * then evaluate every predicate against the loaded state (a pure function of
 * that state and the catalog: no rng, so join order cannot fork the draw
 * order). Counters start at zero, so counter deeds never retro-grant; the
 * emitted events carry retro: true and drain with the next tick to this
 * player only. The dirty marks the pass raised are cleared here because the
 * pass itself was the full evaluation. Last, the account ledger seed
 * (src/sim/account_ledger.ts) lists this character for every deed and relic
 * its own restored state proves, so the union the books read never lacks the
 * character reading it (a blob predating the ledger, or a host that handed in
 * no ledger at all); silent and idempotent, and the server reconciles the
 * same keys into its tables.
 */
export function runBookOfDeedsJoinRetro(ctx: SimContext, meta: PlayerMeta, player: Entity): void {
  seedItemDiscovery(ctx, meta);
  retroFallbackGrants(ctx, meta, player);
  evaluateDeedsFor(ctx, meta, player, true);
  ctx.deedDirtyPids.delete(player.id);
  ctx.deedDirtyKeys.delete(player.id);
  seedAccountLedgerSelf(ctx, meta);
}
