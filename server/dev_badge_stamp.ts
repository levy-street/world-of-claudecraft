// One player's developer-badge stamp, moved out of GameServer.refreshDevBadge
// (the monolith ratchet): the entity flair fields, then the worn rung title
// re-checked against them. Cosmetic only: the sim never reads the flair back,
// and no client command can set it, so the rung is server-resolved or it does
// not exist.
//
// Only an actual contributor (tier > 0, so >= 1 merged PR) carries the flair on
// the wire; a linked non-contributor reads as no badge. Assigning only on a real
// change keeps the identity diff (and so the nearby re-broadcast) quiet.
//
// The title re-check runs every refresh, not only on a tier change: a rung
// title restored at join is taken as saved (the tier resolves after join), so
// the first refresh is what confirms or clears it. It only CLEARS on an
// authoritative answer: no GitHub link at all, or a loaded contributor
// snapshot. A cold GitHub failure after a restart reads every login as 0 merged
// PRs; clearing then would erase a worn title for good over a transient outage.
import { reconcileDevBadgeTitle } from '../src/sim/dev_badge_titles';
import type { PlayerMeta } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { contributorsSnapshotLoaded } from './github_contributors';

/** Stamp the resolved rung on the entity; returns true when the flair changed. */
export function stampDevBadge(
  e: Entity,
  meta: PlayerMeta | null,
  tier: number,
  login: string | null,
  mergedPrs: number,
): boolean {
  const githubLogin = tier > 0 ? (login ?? undefined) : undefined;
  const devMergedPrs = tier > 0 ? mergedPrs : undefined;
  const changed =
    (e.devTier ?? 0) !== tier ||
    (e.devMergedPrs ?? 0) !== (devMergedPrs ?? 0) ||
    e.githubLogin !== githubLogin;
  if (changed) {
    e.devTier = tier;
    e.devMergedPrs = devMergedPrs;
    e.githubLogin = githubLogin;
  }
  if (meta && (login === null || contributorsSnapshotLoaded())) reconcileDevBadgeTitle(meta, e);
  return changed;
}
