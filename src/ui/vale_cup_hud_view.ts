// Pure, host-agnostic view model for the in-match Vale Cup HUD strip: both
// nation flags, the score, the count-down clock, and the phase line (KICKOFF
// countdown / GOAL / GOLDEN GOAL / FULL TIME). Snapshot-driven from
// cupInfo.match so it self-heals on reconnect; the one-shot juice (banners,
// horn, shake) rides the vcup SimEvents in hud.handleEvents, never this model.
//
// DOM-free and i18n-free: the phase is a raw token the painter localizes, and
// `sig` is the STRUCTURAL identity (match id + nations + my side), excluding
// the per-second clock / score / phase, which the painter writes through
// elided setText slots.

import type { VcNationId } from '../sim/types';
import type { CupInfo, VcPhase } from '../world_api';

export interface VcupHudView {
  active: boolean;
  nationA: VcNationId;
  nationB: VcNationId;
  awayPalette: boolean;
  scoreA: number;
  scoreB: number;
  phase: VcPhase;
  golden: boolean;
  /** Seconds until kickoff (phase 'countdown'), else 0. */
  countdown: number;
  /** Remaining match/golden time, split for the painter's clock key. */
  minutes: number;
  seconds: number;
  /** Seconds left in the post-match aftermath (phase 'over'), else 0. */
  returnIn: number;
  myTeam: 'A' | 'B' | null;
  /** Structural identity: rebuild the skeleton only when this changes. */
  sig: string;
}

const INACTIVE: VcupHudView = {
  active: false,
  nationA: 'vale',
  nationB: 'vale',
  awayPalette: false,
  scoreA: 0,
  scoreB: 0,
  phase: 'countdown',
  golden: false,
  countdown: 0,
  minutes: 0,
  seconds: 0,
  returnIn: 0,
  myTeam: null,
  sig: 'off',
};

export function buildVcupHudView(info: CupInfo | null): VcupHudView {
  const m = info?.match ?? null;
  // The pre-match 'briefing' phase is owned by the full-screen briefing overlay
  // (vale_cup_briefing_view.ts); the score strip stays hidden until kickoff so
  // the two never overlap. Everything from 'countdown' onward is the strip's.
  if (!m || m.phase === 'briefing') return INACTIVE;
  const left = Math.max(0, Math.floor(m.timeLeft));
  return {
    active: true,
    nationA: m.nationA,
    nationB: m.nationB,
    awayPalette: m.awayPalette,
    scoreA: m.scoreA,
    scoreB: m.scoreB,
    phase: m.phase,
    golden: m.golden,
    countdown: Math.max(0, Math.ceil(m.countdown)),
    minutes: Math.floor(left / 60),
    seconds: left % 60,
    returnIn: Math.max(0, Math.ceil(m.returnIn ?? 0)),
    myTeam: m.team,
    sig: `${m.id}|${m.nationA}|${m.nationB}|${m.awayPalette ? 1 : 0}|${m.team ?? '-'}`,
  };
}
