// Pure, host-agnostic view model for the persistent Gravemarch battleground
// indicator (the compact badge by the minimap, docs/prd/battlegrounds.md).
//
// The pure-core half of the pure-core + thin-painter split (reference
// arena_window_view.ts). It decides the ONE state the badge is in, priority
// ordered: in a match -> hidden (the in-match HUD takes over); spectating ->
// hidden (the spectate badge shows); queued -> the queue readout; a live match
// on the realm -> the "battle underway" readout with a Watch affordance; else
// hidden. `info === null` is the online not-yet-synced state (hidden).
//
// DOM-free and i18n-free: the view carries raw numbers (position, seconds,
// kills) the painter formats via t()/formatNumber. The sig is TEXT-INDEPENDENT
// (kind + numbers only) so a language switch never moves it on its own;
// relocalize() clears it for exactly one localized rebuild.

import type { BgInfo, BgLiveMatch } from '../world_api';

export type BgIndicatorView =
  | { kind: 'hidden'; sig: string }
  | { kind: 'queued'; position: number; waitSec: number; sig: string }
  | {
      kind: 'live';
      matchId: number;
      elapsed: number;
      killsA: number;
      killsB: number;
      sig: string;
    };

const HIDDEN: BgIndicatorView = { kind: 'hidden', sig: 'h' };

/** The live match the badge advertises: the fullest one (ties: listed first). */
function headlineMatch(matches: BgLiveMatch[]): BgLiveMatch | null {
  let best: BgLiveMatch | null = null;
  for (const m of matches) {
    if (!best || m.players > best.players) best = m;
  }
  return best;
}

/**
 * Build the indicator view. Reads only the IWorld-mirrored BgInfo snapshot, so
 * the offline Sim and the online ClientWorld mirror produce identical output.
 */
export function buildBgIndicatorView(info: BgInfo | null): BgIndicatorView {
  if (!info) return HIDDEN;
  // In a match: the in-match HUD owns the screen. Spectating: the spectate
  // badge owns the readout (and a "watch" affordance would be circular).
  if (info.match !== null || info.spectating !== null) return HIDDEN;
  if (info.queued) {
    return {
      kind: 'queued',
      position: info.position,
      waitSec: info.waitSec,
      sig: `q|${info.position}|${info.waitSec}`,
    };
  }
  const live = headlineMatch(info.liveMatches);
  if (live) {
    return {
      kind: 'live',
      matchId: live.id,
      elapsed: live.elapsed,
      killsA: live.killsA,
      killsB: live.killsB,
      sig: `l|${live.id}|${live.elapsed}|${live.killsA}|${live.killsB}`,
    };
  }
  return HIDDEN;
}
