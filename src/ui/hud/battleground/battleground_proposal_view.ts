// Pure view core for the Thornhollow Fields queue-pop prompt: turns the
// anonymous `BgInfo.proposal` snapshot into exactly what the popup paints, and
// nothing else. DOM-free and Node-tested, so the popup itself stays a thin
// painter (the src/ui/CLAUDE.md pure-core recipe).
//
// The offer is deliberately COUNTS ONLY, never names: the ten fighters have not
// been introduced yet and a decline must not leak who was on the other side.
// That is a sim-side promise (`bgInfoFor`), and this core simply has no field to
// break it with.

import type { BgInfo } from '../../../world_api';

export interface BgProposalPopupView {
  /** A fresh match, or one seat in a battle already under way (unrated). */
  kind: 'match' | 'backfill';
  /** Fighters who have accepted, and how many the offer needs. */
  accepted: number;
  size: number;
  /** True once every fighter has accepted, which is the frame before it seats. */
  full: boolean;
  myResponse: 'pending' | 'accepted';
  remaining: number;
  /** Structural signature: the popup rebuilds its DOM only when this changes,
   *  so the once-per-second countdown refreshes a text slot in place instead. */
  sig: string;
}

export function buildBgProposalPopupView(info: BgInfo | null): BgProposalPopupView | null {
  const p = info?.proposal;
  if (!p) return null;
  // Clamped rather than trusted: `accepted` arrives over the wire, and a count
  // past the roster would paint a meter wider than its own track.
  const accepted = Math.max(0, Math.min(p.size, p.accepted));
  return {
    accepted,
    kind: p.kind,
    size: p.size,
    full: accepted >= p.size,
    myResponse: p.myResponse,
    remaining: Math.max(0, p.remaining),
    // The countdown is deliberately ABSENT from the signature: it changes every
    // second and would rebuild the whole prompt (and drop a half-pressed button)
    // once per tick if it were part of the structure.
    sig: JSON.stringify([p.id, p.kind, p.myResponse, accepted, p.size]),
  };
}
