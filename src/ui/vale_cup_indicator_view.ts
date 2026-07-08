// Pure, host-agnostic view model for the persistent Vale Cup indicator button.
//
// Decides the indicator's state from the CupInfo snapshot alone (works
// identically against the offline Sim and the online ClientWorld mirror):
//   - in my own match: hidden (the match strip owns the screen),
//   - queued: bracket + position + queue size,
//   - a live match is running at the Sowfield: nations + score + elapsed clock,
//   - otherwise hidden.
// The indicator is gameplay chrome, never tier-shed (root CLAUDE.md
// gameplay-neutral graphics invariant): no fx-tier input exists here on purpose.
//
// DOM-free and i18n-free: raw ids + numbers only; `sig` is the STRUCTURAL
// identity (excludes the per-second clock, which the painter writes through an
// elided setText) and is text-independent so relocalize() can force a rebuild.

import type { SportRole, VcBracket, VcNationId } from '../sim/types';
import type { CupInfo } from '../world_api';

export type VcupIndicatorView =
  | { kind: 'hidden'; sig: string }
  | {
      kind: 'queued';
      bracket: VcBracket;
      position: number;
      waiting: number;
      role: SportRole | null;
      sig: string;
    }
  | {
      kind: 'live';
      nationA: VcNationId;
      nationB: VcNationId;
      awayPalette: boolean;
      scoreA: number;
      scoreB: number;
      /** Elapsed clock, split for the painter's {minutes}:{seconds} key. */
      minutes: number;
      seconds: number;
      sig: string;
    };

export function buildVcupIndicatorView(info: CupInfo | null): VcupIndicatorView {
  if (!info) return { kind: 'hidden', sig: 'hidden' };
  // My own match: the match strip (vale_cup_hud.ts) takes over.
  if (info.match !== null) return { kind: 'hidden', sig: 'hidden' };
  if (info.queued && info.bracket !== null) {
    const waiting = info.queueSizes[info.bracket] ?? 0;
    return {
      kind: 'queued',
      bracket: info.bracket,
      position: info.position,
      waiting,
      role: info.role,
      sig: `q|${info.bracket}|${info.position}|${waiting}`,
    };
  }
  if (info.live) {
    const s = Math.max(0, Math.floor(info.live.clock));
    return {
      kind: 'live',
      nationA: info.live.nationA,
      nationB: info.live.nationB,
      awayPalette: info.live.nationA === info.live.nationB,
      scoreA: info.live.scoreA,
      scoreB: info.live.scoreB,
      minutes: Math.floor(s / 60),
      seconds: s % 60,
      // The clock is deliberately NOT in the sig: the painter's elided setText
      // slot carries it so the ~1Hz tick never forces an innerHTML rebuild.
      sig: `l|${info.live.id}|${info.live.nationA}|${info.live.nationB}|${info.live.scoreA}|${info.live.scoreB}`,
    };
  }
  return { kind: 'hidden', sig: 'hidden' };
}
