// Pure, host-agnostic view model for the in-race Gauntlet HUD strip: the
// countdown, the round header (ROUND N of 3, how many advance), the live
// position board (rank, section, progress, falls, the gallery), the
// intermission card, and the aftermath banner state. Snapshot-driven from
// HcInfo so it self-heals on reconnect; one-shot juice (knock cues, the
// qualified/eliminated banners) rides events in hud.ts. DOM/i18n live in
// hodrics_hud.ts.

import type { HcInfo } from '../world_api';

export interface HcHudRacerRow {
  name: string;
  you: boolean;
  bot: boolean;
  progress: number; // 0..1
  finished: boolean;
  place: number | null;
  eliminated: boolean;
  left: boolean;
}

export type HcHudView =
  | { kind: 'hidden' }
  | { kind: 'countdown'; round: number; rounds: number; seconds: number; sig: string }
  | {
      kind: 'race';
      round: number;
      rounds: number;
      qualify: number; // how many advance out of this round
      spectating: boolean; // you are eliminated, watching from the gallery
      rank: number; // my live rank among the living, 1-based
      fieldSize: number; // racers still in the round
      section: string; // course section id (localized by the painter)
      progress: number; // my progress 0..1
      falls: number;
      timeLeft: number; // whole seconds until this round's cap
      finished: boolean;
      place: number | null;
      rows: HcHudRacerRow[];
      sig: string;
    }
  | { kind: 'intermission'; round: number; rounds: number; eliminated: boolean; sig: string }
  | { kind: 'over'; place: number | null; won: boolean; sig: string };

/** Build the race HUD view from the mirrored snapshot. */
export function buildHcHudView(info: HcInfo | null): HcHudView {
  const m = info?.match;
  if (!m) return { kind: 'hidden' };
  if (m.state === 'countdown') {
    return {
      kind: 'countdown',
      round: m.round,
      rounds: m.rounds,
      seconds: m.countdown,
      sig: `c${m.round}:${m.countdown}`,
    };
  }
  if (m.state === 'intermission') {
    return {
      kind: 'intermission',
      round: m.round,
      rounds: m.rounds,
      eliminated: m.eliminated,
      sig: `i${m.round}:${m.eliminated}`,
    };
  }
  if (m.state === 'over') {
    return {
      kind: 'over',
      place: m.place,
      won: m.place === 1,
      sig: `o${m.place ?? 'x'}`,
    };
  }
  const rows: HcHudRacerRow[] = m.racers.map((r) => ({
    name: r.name,
    you: r.you,
    bot: r.bot,
    progress: r.progress,
    finished: r.finished,
    place: r.place,
    eliminated: r.eliminated,
    left: r.left,
  }));
  const living = rows.filter((r) => !r.eliminated && !r.left);
  const rank = Math.max(1, living.findIndex((r) => r.you) + 1);
  const me = rows.find((r) => r.you);
  const timeLeft = Math.max(0, Math.ceil(m.timeLeft));
  const sig = JSON.stringify([
    m.round,
    m.qualify,
    rank,
    m.section,
    m.checkpoint,
    m.falls,
    timeLeft,
    m.finished,
    m.place,
    m.eliminated,
    rows.map((r) => [r.progress.toFixed(3), r.finished, r.place, r.eliminated]),
  ]);
  return {
    kind: 'race',
    round: m.round,
    rounds: m.rounds,
    qualify: m.qualify,
    spectating: m.eliminated,
    rank,
    fieldSize: living.length,
    section: m.section,
    progress: me?.progress ?? 0,
    falls: m.falls,
    timeLeft,
    finished: m.finished,
    place: m.place,
    rows,
    sig,
  };
}
